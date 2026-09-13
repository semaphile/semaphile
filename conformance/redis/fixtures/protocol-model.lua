-- Deterministic Lua protocol model: supplies TIME/GET/SET/PUBLISH and a JSON
-- round-trip map without sockets. This is NOT an actual Redis conformance run.
return function(script, events, config, null)
  local values = {}
  local function copy(value)
    if type(value) ~= 'table' then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
  end
  local function quote(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(character)
      if character == '"' then return '\\"' end
      if character == '\\' then return '\\\\' end
      return string.format('\\u%04x', string.byte(character))
    end) .. '"'
  end
  local function json(value)
    if value == null then return 'null' end
    local kind = type(value)
    if kind == 'string' then return quote(value) end
    if kind == 'boolean' then return tostring(value) end
    if kind == 'number' then return string.format('%.17g', value) end
    if kind ~= 'table' then error('Unsupported model JSON value: ' .. kind) end
    local result = {}
    if #value > 0 then
      for _, item in ipairs(value) do result[#result + 1] = json(item) end
      return '[' .. table.concat(result, ',') .. ']'
    end
    for key, item in pairs(value) do result[#result + 1] = quote(key) .. ':' .. json(item) end
    return '{' .. table.concat(result, ',') .. '}'
  end
  local cjson = {null=null}
  function cjson.encode(value)
    local encoded = json(value)
    values[encoded] = copy(value)
    return encoded
  end
  function cjson.decode(encoded)
    assert(values[encoded], 'JSON model input was not registered')
    return copy(values[encoded])
  end
  local expected = cjson.encode(config)
  local raw, now, publications = nil, 0, 0
  local redis = {}
  function redis.call(action, ...)
    local input = {...}
    if action == 'TIME' then return {tostring(math.floor(now / 1000)), tostring((now % 1000) * 1000)} end
    if action == 'GET' then return raw or false end
    if action == 'SET' then raw = input[2]; return 'OK' end
    if action == 'PUBLISH' then publications = publications + 1; return 0 end
    error('Unexpected Redis model action: ' .. action)
  end
  function redis.error_reply(message) return {error=message} end
  local sequence = {}
  for _, event in ipairs(events) do
    now = event.now
    local number = event.sequence or (sequence[event.owner] or 0) + 1
    local environment = setmetatable({redis=redis, cjson=cjson, KEYS={'pool', 'notify'},
      ARGV={event.action, event.owner, tostring(number), expected, cjson.encode(event.input or {})}}, {__index=_G})
    local fn = assert(load(script, 'semaphile-redis-protocol', 't', environment))
    local ok, result = pcall(fn)
    local record = {publications=publications, state=raw and cjson.decode(raw) or null}
    if not ok then record.error = tostring(result)
    elseif type(result) == 'table' then record.error = result.error
    else
      sequence[event.owner] = number
      record.reply = cjson.decode(result)
    end
    print(json(record))
  end
end
