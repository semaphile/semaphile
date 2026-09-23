-- All writes are staged. Validation/refusal leaves persisted state unchanged.
local root, request = KEYS[1], cjson.decode(ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local array_mt = {}
local function array(t) return setmetatable(t or {}, array_mt) end
local function encode(v)
  if v == nil or v == cjson.null then return 'null' end
  if type(v) ~= 'table' then
    if type(v) == 'number' then return string.format('%.0f', v) end
    return cjson.encode(v)
  end
  local values = {}
  if getmetatable(v) == array_mt or #v > 0 then
    for i = 1, #v do values[i] = encode(v[i]) end
    return '[' .. table.concat(values, ',') .. ']'
  end
  for k, value in pairs(v) do values[#values+1] = cjson.encode(tostring(k)) .. ':' .. encode(value) end
  table.sort(values)
  return '{' .. table.concat(values, ',') .. '}'
end
local function refuse(code, message) error(code .. ':' .. message, 0) end
local function empty(v) return v == nil or v == cjson.null end
local function number(v, default) if empty(v) then return default end return tonumber(v) end
local function key(bucket) return root .. ':' .. bucket end
local function checktype(k, expected)
  local actual = redis.call('TYPE', k).ok
  if actual ~= 'none' and actual ~= expected then refuse('STATE_LOST', 'Unexpected store key type') end
end
checktype(root, 'hash')
local meta_raw = redis.call('HGET', root, 'meta')
local meta = meta_raw and cjson.decode(meta_raw) or nil
local config
local changes, indexes, touched, cache = {}, {}, {}, {}
local bytes = meta and meta.bytes or 0
local function read(bucket, id)
  local composite = bucket .. '\0' .. id
  if cache[composite] ~= nil then return cache[composite] and cjson.decode(encode(cache[composite])) or nil end
  checktype(key(bucket), 'hash')
  local raw = redis.call('HGET', key(bucket), id)
  local value = raw and cjson.decode(raw) or nil
  cache[composite] = value or false
  return value and cjson.decode(encode(value)) or nil
end
local function cost(bucket, value)
  if not value then return 0 end
  if bucket == 'deliveries' and (value.state == 'pending' or value.state == 'claimed') then return 8192 end
  return #encode(value) + 512
end
local function put(bucket, id, value)
  local previous = read(bucket, id)
  bytes = bytes - cost(bucket, previous) + cost(bucket, value)
  cache[bucket .. '\0' .. id] = value or false
  changes[bucket] = changes[bucket] or {}
  changes[bucket][id] = value and encode(value) or false
end
local function zput(bucket, id, score)
  checktype(key(bucket), 'zset')
  indexes[bucket] = indexes[bucket] or {}
  indexes[bucket][id] = score or false
end
local function range(bucket, lower, upper, limit)
  checktype(key(bucket), 'zset')
  local rows
  if limit then
    local extra=0; for _ in pairs(indexes[bucket] or {}) do extra=extra+1 end
    rows=redis.call('ZRANGEBYSCORE',key(bucket),lower,upper,'WITHSCORES','LIMIT',0,limit+extra)
  else
    rows=redis.call('ZRANGEBYSCORE',key(bucket),lower,upper,'WITHSCORES')
  end
  local members = {}
  for i=1,#rows,2 do members[rows[i]] = tonumber(rows[i+1]) end
  for id, score in pairs(indexes[bucket] or {}) do members[id] = score or nil end
  local sorted = {}
  for id, score in pairs(members) do
    if score >= lower and score <= upper then sorted[#sorted+1] = { id=id, score=score } end
  end
  table.sort(sorted, function(a,b) return a.score < b.score or (a.score == b.score and a.id < b.id) end)
  local result = array()
  for i=1,math.min(#sorted, limit or #sorted) do result[#result+1] = sorted[i].id end
  return result
end
local function count(bucket)
  checktype(key(bucket),'zset')
  local n=redis.call('ZCARD',key(bucket))
  for id,score in pairs(indexes[bucket] or {}) do
    local existed=redis.call('ZSCORE',key(bucket),id)
    if existed and not score then n=n-1 elseif not existed and score then n=n+1 end
  end
  return n
end
local function increment(field)
  meta[field] = (meta[field] or 0) + 1
  if meta[field] > 9007199254740991 then refuse('REFUSED', 'Sequence exhausted') end
  return meta[field]
end
local function event(kind, fields)
  local seq = increment('eventSeq')
  local row = fields or {}
  row.seq, row.at, row.kind = seq, now, kind
  put('events', tostring(seq), row)
  zput('event-order', tostring(seq), seq)
  return seq
end
local function inbox(recipient) return 'inbox:' .. redis.sha1hex(recipient) end
local function notify(recipient) touched[recipient] = true end
local function messageTerminal(messageId)
  local m = read('messages', messageId)
  if not m then return end
  for _, id in ipairs(m.deliveryIds) do
    local d = read('deliveries', id)
    if d and (d.state == 'pending' or d.state == 'claimed') then return end
  end
  if empty(m.terminalAt) then
    m.terminalAt = now
    put('messages', m.id, m)
    zput('terminal', m.id, now+config.retainHistoryMs)
    zput('body-terminal', m.id, now)
  end
end
local function storeDelivery(d)
  put('deliveries', d.id, d)
  local live = d.state == 'pending' or d.state == 'claimed'
  zput(inbox(d.recipient), d.id, live and d.seq or nil)
  local expiry = number(d.expiresAt, math.huge)
  if d.state == 'claimed' then expiry = math.min(expiry, d.claimExpiresAt) end
  zput('expiry', d.id, live and expiry < math.huge and expiry or nil)
  notify(d.recipient)
  if not live then messageTerminal(d.messageId) end
end
local function unsuccessful(d, reason)
  local expired = number(d.expiresAt, math.huge) <= now
  d.state = expired and 'expired' or (d.attempts >= config.maxAttempts and 'failed' or 'pending')
  d.claimId, d.claimExpiresAt = nil, nil
  d.availableAt = now + math.min(2147483647, config.retryDelayMs * 2 ^ math.min(30, math.max(0, d.attempts-1)))
  d.error = reason
  storeDelivery(d)
  event(d.state == 'pending' and 'retry-scheduled' or d.state, { subject=d.id, payload=reason })
end
local function retire(s, reason)
  if s.state ~= 'active' then return end
  s.state, s.retiredAt = 'retired', now
  put('subscriptions', s.name, s)
  zput('subscription-expiry', s.name, nil)
  for _,topic in ipairs(s.topics) do zput('topic:'..redis.sha1hex(topic),s.name,nil) end
  zput('subscription-retired',s.name,now)
  put('targets',s.recipient,nil)
  put('mailboxes',s.recipient,nil)
  for _, id in ipairs(range(inbox(s.recipient), -math.huge, math.huge)) do
    local d = read('deliveries', id)
    d.state, d.claimId, d.claimExpiresAt, d.error = 'cancelled', nil, nil, reason
    storeDelivery(d)
  end
  notify(s.recipient)
  event('subscription-retired', { subject=s.id, payload=reason })
end
local function cleanup(pressure)
  local progressed = false
  for _, id in ipairs(range('expiry', -math.huge, now, 256)) do
    local d = read('deliveries', id)
    if d then unsuccessful(d, number(d.expiresAt, math.huge) <= now and 'Message expired' or 'Claim expired') end
    progressed = true
  end
  for _, name in ipairs(range('subscription-expiry', -math.huge, now, 256)) do
    local s = read('subscriptions', name)
    if s then retire(s, 'Subscription inactivity expired') end
    progressed = true
  end
  for _, id in ipairs(range('presence-expiry', -math.huge, now, 256)) do
    local a = read('agents', id)
    if a then a.online=false; put('agents', id, a); zput('agent-retired',id,now); event('offline', {agent=id}) end
    zput('presence-expiry', id, nil)
    progressed = true
  end
  for _, id in ipairs(range(pressure and 'body-terminal' or 'terminal', -math.huge, pressure and math.huge or now, 256)) do
    local m = read('messages', id)
    if m then
      local old = m.terminalAt + config.retainHistoryMs <= now
      if (pressure or old) and not empty(m.envelope) then
        m.envelope, m.trace = nil, nil
        put('messages', id, m); zput('body-order',id,nil); zput('body-terminal',id,nil)
        zput('terminal',id,empty(m.dedupeKey) and now or m.terminalAt+config.dedupeRetentionMs); progressed=true
      end
      if empty(m.envelope) and (empty(m.dedupeKey) or m.terminalAt + config.dedupeRetentionMs <= now) then
        for _, did in ipairs(m.deliveryIds) do put('deliveries', did, nil) end
        if not empty(m.dedupeKey) then
          local current=read('dedupe',m.dedupeKey)
          if current and current.id==id then put('dedupe',m.dedupeKey,nil) end
        end
        put('messages', id, nil); zput('message-order', id, nil); zput('terminal', id, nil)
        progressed=true
      end
    end
  end
  for _, id in ipairs(range('event-order', -math.huge, math.huge, 256)) do
    local e=read('events',id)
    if e and (e.at + config.retainHistoryMs <= now or pressure) then
      put('events',id,nil); zput('event-order',id,nil); progressed=true
    end
  end
  for _,id in ipairs(range('agent-retired',-math.huge,pressure and math.huge or now-config.retainHistoryMs,256)) do
    put('agents',id,nil); zput('agent-order',id,nil); zput('agent-retired',id,nil); progressed=true
  end
  for _,name in ipairs(range('subscription-retired',-math.huge,pressure and math.huge or now-config.retainHistoryMs,256)) do
    local s=read('subscriptions',name)
    if s and s.state=='retired' then put('subscriptions',name,nil); zput('subscription-order',name,nil) end
    zput('subscription-retired',name,nil); progressed=true
  end
  return progressed
end
local function trimEvents()
  local order=range('event-order',-math.huge,math.huge)
  local excess=#order-config.maxEvents
  for i,id in ipairs(order) do
    if i <= excess or bytes > config.maxContentBytes then
      put('events',id,nil); zput('event-order',id,nil)
    end
  end
end
local function requireMailbox(recipient)
  if not read('mailboxes', recipient) then refuse(string.sub(recipient,1,14)=='@subscription:' and 'STALE' or 'REFUSED', 'Unknown or retired mailbox') end
  local target=read('targets',recipient)
  if target then
    local s=read('subscriptions',target.name)
    if not s or s.id ~= target.id or s.state ~= 'active' or number(s.expiresAt,math.huge)<=now then
      refuse('STALE','Subscription retired')
    end
  end
end
