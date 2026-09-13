-- Pure recovery/maintenance rules. All input is a private decoded draft; the
-- surrounding protocol publishes and commits it together with lease changes.
local Control = {}
local numericFields = {}
for _, field in ipairs({
  'generation', 'operationSequence', 'activeAttempts', 'attemptGeneration',
  'cooldownEpoch', 'cooldownStep', 'cooldownUntil', 'breakerEpoch', 'failures',
  'pauseStep', 'openUntil', 'expiresAt', 'at', 'total', 'pending', 'unconfirmed',
  'acknowledged', 'notBefore', 'revision'
}) do numericFields[field] = true end

-- Redis cjson truncates large numbers when encoding. Persist integers as decimal
-- strings; decode only known numeric fields, never operation IDs or human reasons.
function Control.encode(value)
  if type(value) == 'number' then return integerString(value) end
  if type(value) ~= 'table' then return value end
  local result = {}
  for key, item in pairs(value) do result[key] = Control.encode(item) end
  return result
end
function Control.decode(value)
  if type(value) ~= 'table' then return value end
  for key, item in pairs(value) do
    if type(item) == 'table' then value[key] = Control.decode(item)
    elseif numericFields[key] and type(item) == 'string' then value[key] = tonumber(item) end
  end
  return value
end
local function invalid(message) error('SEMAPHILE_INPUT ' .. message) end
local function identity(id)
  if type(id) ~= 'string' or #id == 0 or #id > 256 or id == '__proto__' or id == 'constructor' or id == 'prototype' then
    invalid('invalid operation identity')
  end
end
local function increase(value) return integer(value + 1, 0, MAX_SAFE_INTEGER) end
local function changed(state) state.revision = increase(state.revision) end
local function after(now, delay) return integer(now + delay, 0, MAX_SAFE_INTEGER) end
local function exponential(base, factor, cap, step)
  return math.min(cap, math.ceil(base * factor ^ step))
end
function Control.initial()
  return {
    revision=0,
    recovery = {
      cooldownEpoch=0, cooldownStep=0, cooldownUntil=0, breakerEpoch=0,
      circuit='closed', failures=0, samples={}, pauseStep=0, openUntil=0,
      probe=null, attempts={}
    },
    maintenance = {generation=0, operationSequence=0, mode='active', operations={}, unconfirmed={}},
    bindings={}
  }
end
local function openCircuit(recovery, policy, now, escalate)
  local step = recovery.pauseStep
  if escalate then step = increase(step) end
  local untilAt = after(now, exponential(policy.initialPauseMs, policy.factor, policy.maxPauseMs, step))
  recovery.breakerEpoch = increase(recovery.breakerEpoch)
  recovery.pauseStep, recovery.circuit, recovery.probe, recovery.openUntil = step, 'open', null, untilAt
end
function Control.eligibility(state, policy, now)
  local recovery = state.recovery
  if policy.breaker and recovery.probe ~= null and recovery.probe.expiresAt <= now then
    local expired = recovery.probe.id
    openCircuit(recovery, policy.breaker, now, false)
    recovery.attempts[expired] = nil
    changed(state)
  end
  local deadline = 0
  if recovery.cooldownUntil > now then deadline = recovery.cooldownUntil end
  if recovery.circuit == 'open' and recovery.openUntil > now then deadline = math.max(deadline, recovery.openUntil) end
  if recovery.circuit == 'half-open' then deadline = math.max(deadline, recovery.probe.expiresAt) end
  return deadline == 0, deadline
end
local function ticket(state, ownerId, token)
  if type(token) ~= 'table' then invalid('invalid operation token') end
  identity(token.id)
  integer(token.generation, 1, MAX_SAFE_INTEGER)
  local operation = state.maintenance.operations[token.id]
  if not operation or operation.generation ~= token.generation then return nil end
  if operation.owner ~= ownerId then invalid('operation belongs to another owner') end
  return operation
end
function Control.accept(state, ownerId, id)
  identity(id)
  local maintenance = state.maintenance
  if maintenance.mode ~= 'active' then
    return nil, {name='PoolDrainingError', generation=maintenance.generation, message='Pool is draining'}
  end
  if maintenance.operations[id] or maintenance.unconfirmed[id] then invalid('operation identity already used') end
  maintenance.operationSequence = increase(maintenance.operationSequence)
  local generation = maintenance.operationSequence
  maintenance.operations[id] = {owner=ownerId, generation=generation, attempted=false, activeAttempts=0, attemptGeneration=0}
  changed(state)
  return {id=id, generation=generation}
end
function Control.finish(state, ownerId, token)
  local operation = ticket(state, ownerId, token)
  if not operation then return false end
  if operation.activeAttempts ~= 0 then invalid('cannot finish an active operation') end
  state.maintenance.operations[token.id] = nil
  changed(state)
  return true
end
function Control.validateAttempt(state, ownerId, token)
  local operation = ticket(state, ownerId, token)
  if not operation or operation.activeAttempts ~= 0 then invalid('operation is missing, stale or already active') end
end
function Control.start(state, policy, ownerId, lease, token, autoFinish, now)
  identity(lease)
  Control.validateAttempt(state, ownerId, token)
  local allowed = Control.eligibility(state, policy, now)
  if not allowed or state.bindings[lease] or state.recovery.attempts[lease] then invalid('attempt is not eligible or already exists') end
  local operation = state.maintenance.operations[token.id]
  local generation = increase(operation.attemptGeneration)
  local recovery = state.recovery
  local probe = recovery.circuit == 'open'
  if probe then
    recovery.probe = {id=lease, expiresAt=after(now, policy.breaker.probeTimeoutMs)}
    recovery.circuit = 'half-open'
  end
  operation.attempted, operation.activeAttempts, operation.attemptGeneration = true, 1, generation
  recovery.attempts[lease] = {cooldownEpoch=recovery.cooldownEpoch, breakerEpoch=recovery.breakerEpoch, probe=probe}
  state.bindings[lease] = {owner=ownerId, operation={id=token.id, generation=token.generation}, generation=generation, autoFinish=autoFinish == true}
  changed(state)
end
local function validateOutcome(outcome)
  if type(outcome) ~= 'table' then invalid('invalid outcome') end
  if outcome.kind ~= 'success' and outcome.kind ~= 'throttle' and outcome.kind ~= 'service-failure' and outcome.kind ~= 'neutral' then invalid('invalid outcome kind') end
  for key, _ in pairs(outcome) do
    if key ~= 'kind' and key ~= 'retryAfterMs' and key ~= 'throttled' then invalid('unknown outcome field') end
  end
  if outcome.throttled ~= nil and type(outcome.throttled) ~= 'boolean' then invalid('invalid throttled flag') end
  if outcome.retryAfterMs ~= nil then integer(outcome.retryAfterMs, 0, MAX_SAFE_INTEGER) end
  if outcome.kind == 'success' and (outcome.throttled or outcome.retryAfterMs ~= nil) then invalid('successful outcome cannot request cooldown') end
end
local function cooldown(recovery, policy, attempt, outcome, now)
  if outcome.kind == 'throttle' or outcome.throttled or outcome.retryAfterMs ~= nil then
    local untilAt = recovery.cooldownUntil
    local advance = attempt.cooldownEpoch == recovery.cooldownEpoch
    if advance then
      untilAt = math.max(untilAt, after(now, exponential(policy.retry.baseDelayMs, policy.retry.factor, policy.retry.maxDelayMs, recovery.cooldownStep)))
    end
    if outcome.retryAfterMs ~= nil then untilAt = math.max(untilAt, after(now, outcome.retryAfterMs)) end
    if advance or untilAt > recovery.cooldownUntil then recovery.cooldownEpoch = increase(recovery.cooldownEpoch) end
    if advance then recovery.cooldownStep = increase(recovery.cooldownStep) end
    recovery.cooldownUntil = untilAt
  elseif outcome.kind == 'success' and attempt.cooldownEpoch == recovery.cooldownEpoch and now >= recovery.cooldownUntil then
    recovery.cooldownStep = 0
  end
end
local function trip(recovery, policy, outcome, now)
  if outcome.kind ~= 'success' and outcome.kind ~= 'service-failure' then return false end
  local failed = outcome.kind == 'service-failure'
  if policy.rule == 'consecutive' then
    recovery.failures = failed and increase(recovery.failures) or 0
    return recovery.failures >= policy.failureThreshold
  end
  local samples = {}
  for _, sample in ipairs(recovery.samples) do
    if sample.at > now - policy.windowMs then table.insert(samples, sample) end
  end
  local last = samples[#samples]
  if last and last.at == now then
    last.total = increase(last.total)
    if failed then last.failures = increase(last.failures) end
  else table.insert(samples, {at=now, total=1, failures=failed and 1 or 0}) end
  recovery.samples = samples
  local total, failures = 0, 0
  for _, sample in ipairs(samples) do total, failures = total + sample.total, failures + sample.failures end
  return total >= policy.minimumSamples and failures / total >= policy.failureRatio
end
local function completeRecovery(state, policy, lease, outcome, now)
  validateOutcome(outcome)
  local recovery = state.recovery
  local attempt = recovery.attempts[lease]
  if not attempt then return false end
  Control.eligibility(state, policy, now)
  if not recovery.attempts[lease] then return false end
  cooldown(recovery, policy, attempt, outcome, now)
  if policy.breaker and attempt.breakerEpoch == recovery.breakerEpoch then
    if attempt.probe and recovery.probe ~= null and recovery.probe.id == lease then
      if outcome.kind == 'success' then
        recovery.breakerEpoch = increase(recovery.breakerEpoch)
        recovery.circuit, recovery.probe, recovery.failures, recovery.samples = 'closed', null, 0, {}
        recovery.pauseStep, recovery.openUntil = 0, 0
      else openCircuit(recovery, policy.breaker, now, outcome.kind == 'service-failure') end
    elseif recovery.circuit == 'closed' and trip(recovery, policy.breaker, outcome, now) then
      openCircuit(recovery, policy.breaker, now, false)
    end
  end
  recovery.attempts[lease] = nil
  return true
end
function Control.expire(state, policy, lease, now)
  if completeRecovery(state, policy, lease, {kind='neutral'}, now) then changed(state) end
end
function Control.complete(state, policy, ownerId, lease, outcome, now)
  local binding = state.bindings[lease]
  if not binding or binding.owner ~= ownerId then return false end
  completeRecovery(state, policy, lease, outcome, now)
  local operation = ticket(state, ownerId, binding.operation)
  if operation and operation.activeAttempts ~= 0 and operation.attemptGeneration == binding.generation then operation.activeAttempts = 0 end
  if binding.autoFinish then Control.finish(state, ownerId, binding.operation) end
  state.bindings[lease] = nil
  changed(state)
  return true
end
function Control.abandon(state, policy, ownerId, now)
  local removed = false
  for lease, binding in pairs(state.bindings) do
    if binding.owner == ownerId then Control.expire(state, policy, lease, now); state.bindings[lease] = nil; removed=true end
  end
  for id, operation in pairs(state.maintenance.operations) do
    if operation.owner == ownerId then
      if operation.activeAttempts ~= 0 then state.maintenance.unconfirmed[id] = {owner=ownerId, acknowledged=false, reason=null} end
      state.maintenance.operations[id] = nil
      removed=true
    end
  end
  if removed then changed(state) end
end
function Control.status(state)
  local pending, unconfirmed, acknowledged = 0, 0, 0
  for _ in pairs(state.maintenance.operations) do pending = pending + 1 end
  for _, operation in pairs(state.maintenance.unconfirmed) do
    if operation.acknowledged then acknowledged = acknowledged + 1 else unconfirmed = unconfirmed + 1 end
  end
  local draining = state.maintenance.mode == 'draining'
  return {generation=state.maintenance.generation, mode=state.maintenance.mode, pending=pending,
    unconfirmed=unconfirmed, acknowledged=acknowledged, clean=draining and pending==0 and unconfirmed==0 and acknowledged==0,
    settled=draining and pending==0 and unconfirmed==0}
end
function Control.administer(state, input)
  local maintenance = state.maintenance
  if input.action == 'status' then return end
  if input.action == 'drain' then
    if maintenance.mode == 'active' then maintenance.generation = increase(maintenance.generation); maintenance.mode = 'draining'; changed(state) end
    return
  end
  if maintenance.mode ~= 'draining' or input.generation ~= maintenance.generation then invalid('stale maintenance generation') end
  if input.action == 'resume' then maintenance.mode = 'active'; changed(state); return end
  if input.action ~= 'acknowledge' then invalid('unknown control action') end
  if type(input.reason) ~= 'string' or not string.find(input.reason, '%S') or #input.reason > 4096 or type(input.ids) ~= 'table' or #input.ids == 0 then invalid('acknowledgement requires ids and a reason') end
  for _, id in ipairs(input.ids) do if not maintenance.unconfirmed[id] then invalid('unknown unconfirmed operation') end end
  for _, id in ipairs(input.ids) do maintenance.unconfirmed[id].acknowledged=true; maintenance.unconfirmed[id].reason=input.reason end
  changed(state)
end
