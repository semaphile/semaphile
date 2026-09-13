-- One authoritative state write per operation. Calculate first, publish a hint,
-- then SET while Redis still excludes other commands; errors cannot partly debit.
local action, owner, sequence, expected = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4]
local input = cjson.decode(ARGV[5])
local null, MAX_SAFE_INTEGER = cjson.null, 9007199254740991

local function integerString(n)
  return string.format('%.0f', n)
end

local function integer(n, minimum, limit)
  if type(n) ~= 'number' or n ~= math.floor(n) or n < minimum or n > limit then
    error('SEMAPHILE_INPUT invalid integer')
  end
  return n
end

local function failure(message)
  return redis.error_reply('SEMAPHILE_' .. message)
end
-- semaphile-control-module
-- Validate identity and load the current pool before calculating mutations.
integer(sequence, 1, MAX_SAFE_INTEGER)
-- Redis TIME is authoritative; now is wall-clock milliseconds on that server.
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local raw = redis.call('GET', KEYS[1])
local state
if raw then
  state = cjson.decode(raw)
  if state.format ~= '2' or state.config ~= expected then
    return failure('CONFIG mismatch')
  end
elseif action == 'open' then
  if input.create == false then return failure('LOST missing pool state') end
  local config = cjson.decode(expected)
  state = {
    format = '2', config = expected, owners = {}, leases = {},
    remaining = null, nextAllowed = '0', nextRefresh = null,
    control = Control.encode(Control.initial())
  }
  if config.reservoir ~= null then
    state.remaining = integerString(config.reservoir)
  end
  if config.reservoirRefreshInterval ~= null then
    state.nextRefresh = integerString(now + config.reservoirRefreshInterval)
  end
else
  return failure('LOST missing pool state')
end
local config = cjson.decode(state.config)
local control = Control.decode(state.control)
local previousControlRevision = control.revision
local kind = action
if action == 'control' then kind = 'control:' .. tostring(input.command and input.command.action or 'status') end
local ownerState = state.owners[owner]
if action == 'open' then
  if ownerState then
    return failure('LOST owner already registered')
  end
  if sequence ~= 1 then
    return failure('SEQUENCE invalid registration')
  end
  ownerState = {deadline=integerString(now + config.ownerTimeoutMs), sequence='0'}
  state.owners[owner] = ownerState
elseif not ownerState or tonumber(ownerState.deadline) <= now then
  return failure('LOST owner expired')
end
if sequence == tonumber(ownerState.sequence) then
  if kind ~= ownerState.kind then
    return failure('SEQUENCE operation mismatch')
  end
  if ownerState.reply then
    local replay = cjson.decode(ownerState.reply)
    replay.now, replay.ownerDeadline = integerString(now), ownerState.deadline
    return cjson.encode(replay)
  end
  -- Inspection is read-only: recompute it instead of retaining N snapshots of
  -- N leases. Mutating operations always retain their bounded original result.
elseif sequence ~= tonumber(ownerState.sequence) + 1 then
  return failure('SEQUENCE stale or out of order')
end

local function commit(reply, notify)
  ownerState.sequence, ownerState.kind = integerString(sequence), kind
  local encodedReply = cjson.encode(reply)
  local inspection = action == 'inspect' or (action == 'control' and (not input.command or input.command.action == 'status'))
  ownerState.reply = not inspection and encodedReply or false
  state.control = Control.encode(control)
  if control.revision ~= previousControlRevision then notify = true end
  -- Serialize before publishing: cjson/input failures must not imply a commit.
  local updated = cjson.encode(state)
  if notify then
    redis.call('PUBLISH', KEYS[2], 'changed')
  end
  redis.call('SET', KEYS[1], updated)
  return encodedReply
end
if action == 'renew' then
  -- Renewal only extends ownership. It must not become a periodic capacity
  -- scan or budget-refresh publication while the application is idle.
  ownerState.deadline = integerString(now + config.ownerTimeoutMs)
  return commit({now=integerString(now), ownerDeadline=ownerState.deadline, value=null, admission=null, deadline=null}, false)
end

-- Reclaim on work/inspection; the renewal path above only extends ownership.
local notify, active = false, 0
for id, candidate in pairs(state.owners) do
  if tonumber(candidate.deadline) <= now then
    Control.abandon(control, config.recovery, id, now)
    state.owners[id] = nil
  end
end
for id, lease in pairs(state.leases) do
  if not state.owners[lease.owner] or (lease.expires ~= null and tonumber(lease.expires) <= now) then
    Control.expire(control, config.recovery, id, now)
    state.leases[id], notify = nil, true
  else
    active = active + tonumber(lease.weight)
  end
end

local function refresh()
  if state.nextRefresh == null or now < tonumber(state.nextRefresh) then
    return
  end
  local interval, previous = config.reservoirRefreshInterval, tonumber(state.nextRefresh)
  local nextRefresh = previous + (math.floor((now - previous) / interval) + 1) * interval
  local amount = integerString(config.reservoirRefreshAmount)
  if state.remaining ~= amount then
    notify = true
  end
  state.remaining, state.nextRefresh = amount, integerString(nextRefresh)
end
refresh()
local reply = {now=integerString(now), ownerDeadline=ownerState.deadline, value=null, admission=null, deadline=null}

local function deadline(at)
  if at > now and (reply.deadline == null or at < tonumber(reply.deadline)) then
    reply.deadline = integerString(at)
  end
end

-- Dispatch the operation. Only commit() writes the resulting state.
if action == 'open' then
  -- Subscription is already installed; registration itself grants no capacity.
elseif action == 'acquire' then
  local weight = integer(input.weight, 1, MAX_SAFE_INTEGER)
  if config.maxConcurrent ~= null and weight > config.maxConcurrent then
    return failure('INPUT weight exceeds maxConcurrent')
  end
  if input.expirationMs ~= null then
    integer(input.expirationMs, 1, 2147483647)
  end
  if type(input.lease) ~= 'string' or state.leases[input.lease] then
    return failure('INPUT invalid lease identity')
  end
  if input.circuit ~= nil and input.circuit ~= 'wait' and input.circuit ~= 'fail-fast' then return failure('INPUT invalid circuit behavior') end
  local recoveryAllowed, recoveryDeadline = Control.eligibility(control, config.recovery, now)
  reply.circuit = control.recovery.circuit
  reply.recoveryDeadline = recoveryDeadline == 0 and null or integerString(recoveryDeadline)
  if input.circuit == 'fail-fast' and control.recovery.circuit ~= 'closed' then
    reply.refusal = {name='CircuitOpenError', notBefore=recoveryDeadline == 0 and null or integerString(recoveryDeadline), message='Pool circuit is open'}
    return commit(reply, notify)
  end
  local operation = input.operation
  local autoFinish = input.autoFinish == true
  if operation == nil then
    local implicit = 'implicit:' .. input.lease
    local existing = control.maintenance.operations[implicit]
    if existing then operation = {id=implicit, generation=existing.generation}
    else
      local refusal
      operation, refusal = Control.accept(control, owner, implicit)
      if refusal then reply.refusal=Control.encode(refusal); return commit(reply, notify) end
    end
    autoFinish = true
  end
  Control.validateAttempt(control, owner, operation)
  if active > MAX_SAFE_INTEGER - weight and config.maxConcurrent == null then
    return failure('INPUT capacity overflow')
  end
  local capacity = config.maxConcurrent == null or weight <= config.maxConcurrent - active
  local budget = state.remaining == null or weight <= tonumber(state.remaining)
  if capacity and budget and recoveryAllowed and now >= tonumber(state.nextAllowed) then
    local expires = null
    if input.expirationMs ~= null then
      expires = integerString(now + input.expirationMs)
    end
    Control.start(control, config.recovery, owner, input.lease, operation, autoFinish, now)
    state.leases[input.lease] = {
      owner = owner, weight = integerString(weight),
      expires = expires, granted = integerString(now)
    }
    if state.remaining ~= null then
      state.remaining = integerString(tonumber(state.remaining) - weight)
    end
    state.nextAllowed = integerString(now + config.minTime)
    reply.admission = {
      leaseId = input.lease, leaseGrantedAt = integerString(now),
      expiresAt = expires, weight = integerString(weight)
    }
    notify = true
  else
    for _, lease in pairs(state.leases) do
      deadline(tonumber(state.owners[lease.owner].deadline))
      if lease.expires ~= null then
        deadline(tonumber(lease.expires))
      end
    end
    deadline(tonumber(state.nextAllowed))
    deadline(recoveryDeadline)
    if not budget and state.nextRefresh ~= null and config.reservoirRefreshAmount >= weight then
      deadline(tonumber(state.nextRefresh))
    end
  end
elseif action == 'release' then
  local lease = state.leases[input.lease]
  Control.complete(control, config.recovery, owner, input.lease, input.outcome or {kind='neutral'}, now)
  if lease and lease.owner == owner then
    state.leases[input.lease], notify = nil, true
  end
elseif action == 'accept' then
  local operation, refusal = Control.accept(control, owner, input.operationId)
  reply.value = operation and Control.encode(operation) or null
  if refusal then reply.refusal = Control.encode(refusal) end
elseif action == 'finish' then
  reply.value = Control.finish(control, owner, input.operation)
elseif action == 'control' then
  Control.eligibility(control, config.recovery, now)
  local command = input.command or {action='status'}
  Control.administer(control, command)
  local value = {maintenance=Control.status(control)}
  if command.action == 'status' then
    local recovery = {}
    for name, item in pairs(control.recovery) do if name ~= 'attempts' then recovery[name] = item end end
    value.recovery, value.operations, value.unconfirmed = recovery, control.maintenance.operations, control.maintenance.unconfirmed
  end
  reply.value = Control.encode(value)
  -- A drain with live accepted work also depends on its owners' validity,
  -- even when those owners currently have no concurrency lease.
  for _, operation in pairs(control.maintenance.operations) do
    deadline(tonumber(state.owners[operation.owner].deadline))
  end
elseif action == 'increment' then
  local amount = integer(input.amount, -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER)
  local remaining = 0
  if state.remaining ~= null then
    remaining = tonumber(state.remaining)
  end
  if amount > 0 and remaining > MAX_SAFE_INTEGER - amount then
    return failure('INPUT reservoir overflow')
  end
  if amount < 0 and remaining < -MAX_SAFE_INTEGER - amount then
    return failure('INPUT reservoir overflow')
  end
  state.remaining, notify = integerString(remaining + amount), true
  reply.value = state.remaining
elseif action == 'reservoir' then
  reply.value = state.remaining
elseif action == 'inspect' then
  reply.value = {active=integerString(active), reservoir=state.remaining, leases=state.leases}
elseif action == 'close' then
  Control.abandon(control, config.recovery, owner, now)
  for id, lease in pairs(state.leases) do
    if lease.owner == owner then
      state.leases[id], notify = nil, true
    end
  end
  state.owners[owner] = nil
else
  return failure('INPUT unknown operation')
end
return commit(reply, notify)
