local function send(input, publication)
  local envelope=input.envelope
  local existing=envelope.dedupeKey and read('dedupe',envelope.dedupeKey)
  if existing then
    local m=read('messages',existing.id)
    if m and (empty(m.terminalAt) or m.terminalAt+config.dedupeRetentionMs>now) then
      if m.fingerprint~=input.fingerprint then refuse('REFUSED','Conflicting dedupe key') end
      return {id=m.id,seq=m.seq,recipients=m.recipients,deduplicated=true}
    end
  end
  local recipients=array()
  if publication then
    for _, name in ipairs(range('topic:'..redis.sha1hex(envelope.topic),-math.huge,math.huge)) do
      local s=read('subscriptions',name)
      if s and s.state=='active' and number(s.expiresAt,math.huge)>now then
        for _, topic in ipairs(s.topics) do
          if topic==envelope.topic then recipients[#recipients+1]=s.recipient; break end
        end
      end
    end
  elseif envelope.to=='*' then
    local seen={}
    for _,id in ipairs(range('presence-expiry',now+1,math.huge)) do
      local a=read('agents',id)
      if a and a.online and not seen[a.name] then seen[a.name]=true; recipients[#recipients+1]=a.name end
    end
  else
    if read('targets',envelope.to) then refuse('REFUSED','Use publication for subscription destinations') end
    recipients[1]=envelope.to
  end
  table.sort(recipients)
  if #recipients==0 then refuse('REFUSED','No matching recipients') end
  for _,recipient in ipairs(recipients) do
    requireMailbox(recipient)
    if count(inbox(recipient))>=config.maxPendingPerRecipient then refuse('REFUSED','Recipient full') end
  end
  if count('body-order')>=config.maxMessages then refuse('REFUSED','maxMessages reached') end
  local seq=increment('messageSeq')
  local m={id=input.id,seq=seq,envelope=envelope,trace=input.trace,recipients=recipients,
    fingerprint=input.fingerprint,dedupeKey=envelope.dedupeKey,createdAt=now,deliveryIds=array()}
  for i,recipient in ipairs(recipients) do m.deliveryIds[i]=input.id..':'..i end
  put('messages',m.id,m)
  zput('message-order',m.id,seq)
  zput('body-order',m.id,seq)
  for i,recipient in ipairs(recipients) do
    local d={id=m.deliveryIds[i],messageId=m.id,seq=seq,recipient=recipient,state='pending',attempts=0,
      availableAt=now,expiresAt=envelope.expiresInMs and now+envelope.expiresInMs or nil}
    storeDelivery(d)
  end
  if envelope.dedupeKey then put('dedupe',envelope.dedupeKey,{id=m.id}) end
  event(publication and 'published' or 'sent',{subject=m.id,agent=envelope.sender,topic=envelope.topic})
  return {id=m.id,seq=seq,recipients=recipients,deduplicated=false}
end
local function receive(input)
  local recipient=input.recipient
  requireMailbox(recipient)
  local options=input.options or {}
  local max=number(options.max,1)
  local ttl=number(options.claimTtlMs,config.claimTtlMs)
  local handling=number(options.maxHandlingMs,config.maxHandlingMs)
  local mode=options.ackMode or 'manual'
  local accepted=options.acceptedAckModes or {mode}
  local result=array()
  local deadline=math.huge
  local inspected=0
  for _,id in ipairs(range(inbox(recipient),-math.huge,math.huge)) do
    local d=read('deliveries',id)
    local m=read('messages',d.messageId)
    if d.state=='pending' and d.availableAt<=now and number(d.expiresAt,math.huge)>now and inspected<max then
      inspected=inspected+1
      local effective=m.envelope.ackMode or mode
      local compatible=false
      for _,v in ipairs(accepted) do if v==effective then compatible=true end end
      if not compatible then
        d.state,d.error='failed','Incompatible acknowledgment policy'
        storeDelivery(d)
        event('refused',{subject=d.id,payload=d.error})
      else
        d.state,d.attempts,d.claimId,d.claimedAt='claimed',d.attempts+1,input.claimId..':'..inspected,now
        d.handlingExpiresAt=math.min(now+handling,number(d.expiresAt,math.huge))
        d.claimExpiresAt=math.min(now+ttl,d.handlingExpiresAt)
        d.error=nil
        storeDelivery(d)
        event('claimed',{subject=d.id})
        result[#result+1]={id=d.id,messageId=m.id,seq=m.seq,recipient=recipient,message=m.envelope,
          trace=m.trace,receipt={deliveryId=d.id,claimId=d.claimId},attempt=d.attempts,ackMode=effective,
          claimedAt=now,claimExpiresAt=d.claimExpiresAt,handlingExpiresAt=d.handlingExpiresAt}
      end
    end
    if d.state=='pending' then deadline=math.min(deadline,math.max(now,d.availableAt)) end
    if d.state=='claimed' then deadline=math.min(deadline,d.claimExpiresAt) end
    if d.state=='pending' or d.state=='claimed' then deadline=math.min(deadline,number(d.expiresAt,math.huge)) end
  end
  local target=read('targets',recipient)
  if target then deadline=math.min(deadline,number(read('subscriptions',target.name).expiresAt,math.huge)) end
  return {deliveries=result,deadline=deadline<math.huge and deadline or cjson.null}
end
local function claim(action,input)
  local d=read('deliveries',input.receipt.deliveryId)
  if d and d.state=='acked' and d.ackedClaim==input.receipt.claimId and (action=='ack' or action=='renew') then return {status='acked'} end
  if not d or d.state~='claimed' or d.claimId~=input.receipt.claimId or d.claimExpiresAt<=now or number(d.expiresAt,math.huge)<=now then return {status='stale'} end
  local target=read('targets',d.recipient)
  if target then
    local s=read('subscriptions',target.name)
    if not s or s.id~=target.id or s.state~='active' or number(s.expiresAt,math.huge)<=now then return {status='stale'} end
  end
  if action=='renew' then
    d.claimExpiresAt=math.max(d.claimExpiresAt,math.min(now+number(input.value,config.claimTtlMs),d.handlingExpiresAt,number(d.expiresAt,math.huge)))
    storeDelivery(d)
    return {status='renewed',expiresAt=d.claimExpiresAt}
  elseif action=='ack' then
    d.state,d.ackedClaim,d.claimId,d.claimExpiresAt='acked',d.claimId,nil,nil
    storeDelivery(d)
    event('acked',{subject=d.id})
    return {status='acked'}
  end
  unsuccessful(d,action=='fail' and (input.value or 'Handler failed') or 'Released')
  return {status='released'}
end
local function history(input)
  local result=array()
  for _,id in ipairs(range('message-order',number(input.after,0)+1,math.huge)) do
    local m=read('messages',id)
    local included=empty(m.terminalAt) or m.terminalAt+config.retainHistoryMs>now
    local envelope=m.envelope
    for _,field in ipairs({'sender','correlationId','topic'}) do
      if input[field] and (empty(envelope) or envelope[field]~=input[field]) then included=false end
    end
    if input.since and m.createdAt<input.since then included=false end
    local deliveries=array()
    local recipientMatch=not input.recipient
    for _,did in ipairs(m.deliveryIds) do
      local d=read('deliveries',did)
      if d then
        if d.recipient==input.recipient then recipientMatch=true end
        deliveries[#deliveries+1]={id=d.id,recipient=d.recipient,state=d.state,attempts=d.attempts,error=d.error or cjson.null}
      end
    end
    if included and recipientMatch then
      table.sort(deliveries,function(a,b) return a.recipient<b.recipient end)
      result[#result+1]={id=m.id,seq=m.seq,recipients=m.recipients,deduplicated=false,trace=m.trace,
        message=envelope or cjson.null,createdAt=m.createdAt,terminalAt=m.terminalAt or cjson.null,deliveries=deliveries}
      if #result>=number(input.limit,100) then break end
    end
  end
  return result
end
