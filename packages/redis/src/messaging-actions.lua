local function execute()
  local action,input=request.action,request.input or {}
  if request.before and now>=request.before then refuse('TIMEOUT','Operation expired before execution') end
  if action=='open' then
    if not meta then
      if not input.create then refuse('STATE_LOST','Messaging store missing') end
      for _,bucket in ipairs({'messages','deliveries','mailboxes','subscriptions','events','dedupe'}) do
        if redis.call('EXISTS',key(bucket))~=0 then refuse('STATE_LOST','Orphaned messaging records') end
      end
      meta={format='semaphile-redis-messaging/1',identity=input.identity,config=input.config,bytes=0,messageSeq=0,eventSeq=0}
    end
    if meta.format~='semaphile-redis-messaging/1' then refuse('FORMAT','Unsupported Redis messaging format') end
    if input.expectedIdentity and meta.identity~=input.expectedIdentity then refuse('STATE_LOST','Messaging store replaced') end
    if input.configMismatch=='error' and encode(meta.config)~=encode(input.config) then refuse('CONFIG_MISMATCH','Messaging config differs') end
    config=meta.config
    return {identity=meta.identity,config=config,format=meta.format}
  end
  if not meta or meta.identity~=request.identity then refuse('STATE_LOST','Messaging store missing or replaced') end
  if meta.format~='semaphile-redis-messaging/1' then refuse('FORMAT','Unsupported Redis messaging format') end
  config=meta.config
  if action=='sweep' then return {progress=cleanup(input.pressure==true)} end
  if action=='create' then
    if read('targets',input.recipient) then refuse('REFUSED','Reserved subscription mailbox') end
    if not read('mailboxes',input.recipient) then put('mailboxes',input.recipient,{name=input.recipient,createdAt=now}) end
    return cjson.null
  elseif action=='register' then
    requireMailbox(input.recipient)
    if read('targets',input.recipient) then refuse('REFUSED','Subscription cannot register agent presence') end
    for _,id in ipairs(range('presence-expiry',now+1,math.huge)) do
      local previous=read('agents',id)
      if previous and previous.online and previous.name==input.recipient then refuse('REFUSED','Mailbox already online') end
    end
    local a={id=input.id,name=input.recipient,pid=input.pid,host=input.host,registeredAt=now,metadata=input.metadata or '{}',online=true,expiresAt=now+input.ttl,owner=input.owner}
    put('agents',a.id,a); zput('agent-order',a.id,now); zput('presence-expiry',a.id,a.expiresAt)
    event('online',{agent=a.id,subject=a.name})
    return a
  elseif action=='unregister' then
    local a=read('agents',input.ownerId)
    if not a or a.owner~=input.owner or not a.online then refuse('REFUSED','Registration belongs to another client or is already closed') end
    if a and a.owner==input.owner and a.online then
      a.online=false; put('agents',a.id,a); zput('presence-expiry',a.id,nil); zput('agent-retired',a.id,now); event('offline',{agent=a.id})
    end
    return cjson.null
  elseif action=='presence-renew' then
    local active=array()
    for _,id in ipairs(input.ids) do
      local a=read('agents',id)
      if a and a.owner==input.owner and a.online and a.expiresAt>now then
        a.expiresAt=now+input.ttl; put('agents',id,a); zput('presence-expiry',id,a.expiresAt); active[#active+1]=id
      end
    end
    return active
  elseif action=='agents' then
    local result=array()
    for _,id in ipairs(range('agent-order',-math.huge,math.huge)) do
      local a=read('agents',id)
      if a then a.online=a.online and a.expiresAt>now; a.owner=nil; a.expiresAt=nil; result[#result+1]=a end
    end
    return result
  elseif action=='send' or action=='publish' then return send(input,action=='publish')
  elseif action=='receive' then return receive(input)
  elseif action=='ack' or action=='release' or action=='renew' or action=='fail' then return claim(action,input)
  elseif action=='retry' then
    local d=read('deliveries',input.deliveryId)
    local m=d and read('messages',d.messageId)
    if not d or d.state~='failed' or empty(m.envelope) or number(d.expiresAt,math.huge)<=now then refuse('REFUSED','Retained failed unexpired message required') end
    requireMailbox(d.recipient)
    if count(inbox(d.recipient))>=config.maxPendingPerRecipient then refuse('REFUSED','Recipient full') end
    d.state,d.attempts,d.claimId,d.claimExpiresAt,d.availableAt,d.error='pending',0,nil,nil,now,nil
    m.terminalAt=nil; put('messages',m.id,m); zput('terminal',m.id,nil); zput('body-terminal',m.id,nil)
    storeDelivery(d); event('retried',{subject=d.id}); return cjson.null
  elseif action=='history' then return history(input)
  elseif action=='events' then
    local result=array()
    for _,id in ipairs(range('event-order',number(input.after,0)+1,math.huge)) do
      local e=read('events',id)
      if e and e.at+config.retainHistoryMs>now and (not input.topic or e.topic==input.topic) and (not input.since or e.at>=input.since) then
        result[#result+1]=e; if #result>=number(input.limit,100) then break end
      end
    end
    return result
  elseif action=='append' then return event(input.kind,input)
  elseif action=='subscribe' then
    local previous=read('subscriptions',input.name)
    if previous and previous.state=='active' and number(previous.expiresAt,math.huge)>now then
      if encode(previous.topics)~=encode(input.topics) or number(previous.inactivityTtlMs,0)~=number(input.inactivityTtlMs,0) then refuse('CONFIG_MISMATCH','Subscription options differ') end
      return previous
    end
    if previous then retire(previous,'Subscription inactivity expired') end
    local recipient='@subscription:'..input.id
    local s={id=input.id,name=input.name,topics=input.topics,recipient=recipient,state='active',createdAt=now,
      inactivityTtlMs=input.inactivityTtlMs,expiresAt=input.inactivityTtlMs and now+input.inactivityTtlMs or nil}
    for _,topic in ipairs(s.topics) do zput('topic:'..redis.sha1hex(topic),s.name,now) end
    put('subscriptions',s.name,s); put('targets',recipient,{name=s.name,id=s.id})
    put('mailboxes',recipient,{name=recipient,createdAt=now})
    zput('subscription-retired',s.name,nil); zput('subscription-order',s.name,now); zput('subscription-expiry',s.name,s.expiresAt)
    event('subscription-created',{subject=s.id}); return s
  elseif action=='subscription-get' or action=='subscription-touch' or action=='subscription-remove' then
    local s=read('subscriptions',input.name)
    if not s or (input.id and s.id~=input.id) then refuse('STALE','Subscription generation missing') end
    if action=='subscription-get' then
      if s.state=='active' and number(s.expiresAt,math.huge)<=now then s.state='retired' end
      return s
    elseif action=='subscription-remove' then retire(s,'Subscription removed'); return cjson.null
    end
    if s.state~='active' or number(s.expiresAt,math.huge)<=now then refuse('STALE','Subscription retired') end
    if s.inactivityTtlMs then s.expiresAt=now+s.inactivityTtlMs; put('subscriptions',s.name,s); zput('subscription-expiry',s.name,s.expiresAt) end
    return s
  elseif action=='subscriptions' then
    local result=array()
    for _,name in ipairs(range('subscription-order',-math.huge,math.huge)) do
      local s=read('subscriptions',name)
      if s then
        if s.state=='active' and number(s.expiresAt,math.huge)<=now then s.state='retired' end
        result[#result+1]=s
      end
    end
    return result
  elseif action=='info' then return {identity=meta.identity,format=meta.format,config=config,bytes=bytes}
  end
  refuse('INPUT','Unknown messaging action')
end
local ok,value=pcall(execute)
if not ok then
  local code,message=tostring(value):match('^([A-Z_]+):(.*)$')
  return encode({ok=false,code=code or 'STORE',message=message or 'Messaging operation failed'})
end
if config then trimEvents() end
if config and bytes>config.maxContentBytes then return encode({ok=false,code='REFUSED',message='maxContentBytes reached'}) end
if request.action=='append' and not read('events',tostring(value)) then
  return encode({ok=false,code='REFUSED',message='Event cannot fit within maxContentBytes'})
end
-- Lua isolates scripts but does not roll back command errors. Preflight every
-- mutation and notification, including per-key/channel ACLs, before writing.
meta.bytes=bytes
local final=encode(meta)
local function permitted(...)
  if not redis.acl_check_cmd(...) then refuse('ACCESS','Messaging write permission denied') end
end
local preflight_ok=pcall(function()
  for bucket,rows in pairs(changes) do
    checktype(key(bucket),'hash')
    for id,raw in pairs(rows) do
      if raw then permitted('HSET',key(bucket),id,raw) else permitted('HDEL',key(bucket),id) end
    end
  end
  for bucket,rows in pairs(indexes) do
    checktype(key(bucket),'zset')
    for id,score in pairs(rows) do
      if score then permitted('ZADD',key(bucket),score,id) else permitted('ZREM',key(bucket),id) end
    end
  end
  for recipient in pairs(touched) do permitted('PUBLISH',key('notify'),recipient) end
  if final~=meta_raw then permitted('HSET',root,'meta',final) end
end)
if not preflight_ok then return encode({ok=false,code='ACCESS',message='Messaging mutation preflight failed'}) end
for recipient in pairs(touched) do redis.call('PUBLISH',key('notify'),recipient) end
for bucket,rows in pairs(changes) do
  for id,raw in pairs(rows) do
    if raw then redis.call('HSET',key(bucket),id,raw) else redis.call('HDEL',key(bucket),id) end
  end
end
for bucket,rows in pairs(indexes) do
  for id,score in pairs(rows) do
    if score then redis.call('ZADD',key(bucket),score,id) else redis.call('ZREM',key(bucket),id) end
  end
end
if final~=meta_raw then redis.call('HSET',root,'meta',final) end
return encode({ok=true,value=value,now=now})
