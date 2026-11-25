# Real-player retention metrics from a pre-reset D1 export loaded into sqlite (pre.db). Read-only.
import sqlite3,datetime as D,json,statistics as S,collections
c=sqlite3.connect('pre.db')
NOV9=int(D.datetime(2026,11,9).timestamp()*1000)
REAL={8:'ricky1439',53:'vnonymous567',40:'vnonymous56',39:'heresjohnnie69415',1:'tg 7313143643 (protected)',9:'Kidd69'}
def tot(ids):
  q=f"select sum(wager),sum(gaming_payout),sum(wager_refund),count(case when kind='launch' then 1 end) from economy_ledger where account_id in ({','.join(map(str,ids))}) and created_at>=?"
  w,p,rf,n=c.execute(q,(NOV9,)).fetchone()
  aw,ap,an=c.execute(f"select sum(wager),sum(gaming_payout),sum(n) from economy_archive where account_id in ({','.join(map(str,ids))}) and kind in ('launch','state','spin')").fetchone()
  return dict(wager=w,pay=p,refund=rf,shots=n,arch_w=aw,arch_p=ap,arch_n=an)
allids=[r[0] for r in c.execute('select id from accounts')]
test=[i for i in allids if i not in REAL]
out={}
for name,ids in [('real',list(REAL)),('test',test),('all',allids)]:
  t=tot(ids); W=(t['wager'] or 0)+(t['arch_w'] or 0); P=(t['pay'] or 0)+(t['arch_p'] or 0)
  # spin = temple bonus wager; separate
  t['rtp_total']=P/W if W else None; out[name]=t
  # fish-only
  fw,fp=c.execute(f"select sum(case when kind='launch' then wager end),sum(case when kind in ('launch','state') then gaming_payout end) from economy_ledger where account_id in ({','.join(map(str,ids))}) and created_at>=?",(NOV9,)).fetchone()
  aw,ap=c.execute(f"select sum(case when kind='launch' then wager end),sum(case when kind in ('launch','state') then gaming_payout end) from economy_archive where account_id in ({','.join(map(str,ids))})").fetchone()
  t['fish_rtp']=((fp or 0)+(ap or 0))/((fw or 0)+(aw or 0)) if (fw or aw) else None
  print(name,t)
# per-account real
for i,nm in REAL.items():
  print(i,nm,tot([i]))
# sessions (real, per-row ledger, gap>5min)
GAP=5*60*1000
rows=c.execute(f"select account_id,kind,wager,gaming_payout,balance_after,created_at,action_id,rtp_period from economy_ledger where account_id in ({','.join(map(str,REAL))}) and created_at>=? order by account_id,created_at,id",(NOV9,)).fetchall()
sess=[];cur=None
for r in rows:
  a,k,w,p,b,t,aid,per=r
  if cur is None or cur['a']!=a or t-cur['last']>GAP:
    cur=dict(a=a,start=t,last=t,shots=0,wager=0,pay=0,startbal=None,endbal=b,events=[],stakes=[]); sess.append(cur)
  cur['last']=t; cur['endbal']=b
  if k=='launch' and w>0:
    if cur['startbal'] is None: cur['startbal']=b+w
    cur['shots']+=1; cur['wager']+=w; cur['events'].append(('s',w,t)); cur['stakes'].append(w)
  if p>0 and k in('launch','state'):
    cur['pay']+=p; cur['events'].append(('p',p,t))
sess=[s for s in sess if s['shots']>0]
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))] if v else None
print('\nREAL sessions',len(sess))
for s in sess:
  ms=(s['last']-s['start'])/1000
  # trailing no-pay streak at end
  tr=0
  for e in reversed(s['events']):
    if e[0]=='p': break
    tr+=1
  s['trail']=tr; s['dur']=ms
  minstake=min(s['stakes']); s['bust']= s['endbal']<min(s['stakes'][-5:])
  print(REAL[s['a']][:12],D.datetime.fromtimestamp(s['start']/1000).strftime('%m-%d %H:%M'),'shots',s['shots'],'dur_s',round(ms),'startbal',s['startbal'],'end',s['endbal'],'wag',s['wager'],'pay',s['pay'],'rtp',round(s['pay']/s['wager'],3),'medstake',S.median(s['stakes']),'trailNoPay',tr,'bust',s['bust'])
sh=[s['shots'] for s in sess]; du=[s['dur'] for s in sess]
print('shots/session median',S.median(sh),'p90',pct(sh,.9),'mean',round(S.mean(sh),1))
print('dur/session median s',S.median(du),'p90',pct(du,.9))
# shot rate
rates=[s['shots']/s['dur'] for s in sess if s['dur']>30]
print('shots/sec median',S.median(rates))
# hit frequency: share of shots followed by payout before next shot? use payouts per shot count
npay=sum(1 for s in sess for e in s['events'] if e[0]=='p'); nshot=sum(sh)
print('payout events per shot',npay/nshot, npay, nshot)
# no-pay streak distribution (shots between payouts)
streaks=[];
for s in sess:
  run=0
  for e in s['events']:
    if e[0]=='s': run+=1
    else: streaks.append(run); run=0
print('shots between payouts median',S.median(streaks),'p90',pct(streaks,.9),'max',max(streaks))
tr=[s['trail'] for s in sess]
print('trailing no-pay at session end',sorted(tr))
lt=sum(1 for s in sess if s['trail']>=pct(streaks,.9)); print('sessions ending after >=p90 streak',lt,'of',len(sess))
# win size distribution as multiple of preceding stake
mults=[]
for s in sess:
  last=None
  for e in s['events']:
    if e[0]=='s': last=e[1]
    elif last: mults.append(e[1]/last)
b=collections.Counter()
for m in mults:
  for lo,hi,l in [(0,1,'<1x'),(1,2,'1-2x'),(2,5,'2-5x'),(5,10,'5-10x'),(10,25,'10-25x'),(25,1e9,'25x+')]:
    if lo<=m<hi: b[l]+=1
print('win mult buckets',dict(b),'median',S.median(mults),'p90',pct(mults,.9),'max',max(mults))
big=sorted([e[1] for s in sess for e in s['events'] if e[0]=='p'])[-5:]; print('largest payouts cents',big)
stakes=[w for s in sess for w in s['stakes']]; print('stake cents median',S.median(stakes),'p90',pct(stakes,.9),'max',max(stakes), collections.Counter(stakes).most_common(8))
json.dump(dict(stakes=stakes,shots=sh,dur=du,streaks=streaks,mults=mults,trail=tr),open('real_stats.json','w'))
