"use strict";(()=>{function O(a){let t=a.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);return t?{owner:t[1],repo:t[2]}:null}function M(a){let t=a.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);if(t)return{owner:t[1],repo:t[2],number:parseInt(t[3],10),type:"issue"};let e=a.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);return e?{owner:e[1],repo:e[2],number:parseInt(e[3],10),type:"pr"}:null}var S={gray:"#6b7280",yellow:"#eab308",green:"#22c55e",red:"#ef4444",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899",orange:"#f97316"},C={todo:"To-do",in_progress:"In Progress",complete:"Complete"},E=["todo","in_progress","complete"];var G=["bug","daily"],B="help wanted",q=2e3,V=1500,Y=[".js-issue-labels",'[data-testid="issue-labels"]','[aria-label="Labels"]'];function c(a){return chrome.runtime.sendMessage(a)}function I(){return document.documentElement.getAttribute("data-color-mode")==="dark"||document.documentElement.getAttribute("data-dark-theme")==="dark"||document.documentElement.classList.contains("dark")}function k(a){return S[a]??S.gray}var v=class{container;shadow;root;task=null;linkedTasks=[];statuses=[];dropdownOpen=!1;loading=!0;error=null;owner;repo;number;mode;linkedIssueNumbers;labels=[];proposal=null;proposalDraftBody="";proposalBusy=!1;proposalPollHandle=null;proposalNotice=null;destroyed=!1;autoPostEnabled=!0;fastPathHandle=null;fastPathObservers=[];fastPathEtag=null;fastPathTriggered=!1;fastPathVisibilityListener=null;constructor(t,e,s,r="issue",o=[]){this.owner=t,this.repo=e,this.number=s,this.mode=r,this.linkedIssueNumbers=o,this.container=document.createElement("div"),this.container.id="tasker-status-widget",r==="pr"&&(this.container.style.display="inline-flex",this.container.style.alignItems="center",this.container.style.flexShrink="0",this.container.style.alignSelf="start",this.container.style.position="relative"),this.shadow=this.container.attachShadow({mode:"closed"}),this.root=document.createElement("div"),this.shadow.appendChild(this.root);let i=document.createElement("style");i.textContent=this.mode==="pr"?this.getHeaderStyles():this.getSidebarStyles(),this.shadow.appendChild(i),document.addEventListener("click",l=>{!this.container.contains(l.target)&&this.dropdownOpen&&(this.dropdownOpen=!1,this.render())})}get element(){return this.container}async init(){this.loading=!0,this.error=null,this.render();try{let t=await c({type:"GET_SESSION"});if(!t.ok||!t.data){this.loading=!1,this.error="Not signed in to Tasker",this.render();return}this.mode==="pr"?await this.initPr():await this.initIssue()}catch(t){this.error=t.message??"Connection error"}this.loading=!1,this.render()}async initIssue(){let[t,e,s,r,o]=await Promise.all([c({type:"QUERY_TASK",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_STATUSES"}),c({type:"QUERY_ISSUE_LABELS",owner:this.owner,repo:this.repo,number:this.number}),c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number}),c({type:"GET_AUTOPOST"})]);t.ok?this.task=t.data??null:this.error=t.error??"Failed to load task",e.ok&&e.data&&(this.statuses=e.data),s.ok&&s.data&&(this.labels=s.data),r.ok&&(this.proposal=r.data??null,this.proposalDraftBody=this.proposal?.body??""),o.ok&&o.data&&(this.autoPostEnabled=o.data.enabled),(this.proposal?.state==="armed"||this.proposal?.state==="posting")&&(this.startProposalPoll(),this.startFastPath()),this.proposal?.state==="posted"&&this.proposal.github_comment_id&&this.verifyPostedComment()}async verifyPostedComment(){if(!this.proposal||this.proposal.state!=="posted")return;let t=this.proposal.id,e=await c({type:"VERIFY_POSTED_COMMENT",proposalId:t});if(!this.destroyed&&!(!e.ok||!e.data)&&e.data.state!==this.proposal?.state){let s=e.data.state==="draft";this.proposal=e.data,this.proposalDraftBody=e.data.body??"",s&&(this.proposalNotice="Previous comment was deleted on GitHub \u2014 reverted to draft.",setTimeout(()=>{this.destroyed||(this.proposalNotice=null,this.render())},8e3)),this.render()}}async initPr(){if(this.linkedIssueNumbers.length===0){this.error="No linked issues found";return}let[t,e]=await Promise.all([c({type:"QUERY_TASKS_BATCH",owner:this.owner,repo:this.repo,issueNumbers:this.linkedIssueNumbers}),c({type:"QUERY_STATUSES"})]);t.ok?this.linkedTasks=t.data??[]:this.error=t.error??"Failed to load tasks",e.ok&&e.data&&(this.statuses=e.data)}render(){this.mode==="pr"?this.renderPr():this.renderSidebar()}renderPr(){let t=I();if(this.root.innerHTML="",this.root.className=`tasker-header ${t?"dark":"light"}`,this.loading){this.root.innerHTML='<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>';return}if(this.error){this.root.innerHTML="";return}this.linkedTasks.length!==0&&this.renderPrStatusBadge()}renderPrStatusBadge(){let e=new Set(this.linkedTasks.map(d=>d.status)).size>1,s,r,o;if(e)r=S.purple,o="Mixed";else{let d=this.linkedTasks[0].status;s=this.statuses.find(h=>h.key===d),r=k(s?s.color:"gray"),o=s?.label??d}let i=document.createElement("div");i.className="tasker-wrapper";let l=document.createElement("button");l.className="tasker-btn has-status",l.innerHTML=`
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${r}"></span>
      <span class="status-label">${this.escapeHtml(o)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length>1?"s":""}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,l.addEventListener("click",d=>{d.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),i.appendChild(l),this.root.appendChild(i),this.dropdownOpen&&this.root.appendChild(this.renderPrDropdown())}renderPrDropdown(){let t=document.createElement("div");t.className="dropdown";let e=document.createElement("div");e.className="linked-notice",e.innerHTML=`Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length>1?"s":""}: ${this.linkedTasks.map(r=>`#${r.issue_number}`).join(", ")}`,t.appendChild(e);let s=this.groupStatuses();for(let r of E){let o=s[r];if(!o||o.length===0)continue;let i=document.createElement("div");i.className="group-label",i.textContent=C[r],t.appendChild(i);for(let l of o){let d=this.linkedTasks.every(p=>p.status===l.key),h=document.createElement("button");h.className=`status-row ${d?"active":""}`,h.innerHTML=`
          <span class="dot" style="background:${k(l.color)}"></span>
          <span class="label">${this.escapeHtml(l.label)}</span>
        `,h.addEventListener("click",async p=>{p.stopPropagation(),await this.updateLinkedStatuses(l.key,l.group_name)}),t.appendChild(h)}}return t}async updateLinkedStatuses(t,e){let s=this.linkedTasks.map(i=>({status:i.status,group:i.status_group}));for(let i of this.linkedTasks)i.status=t,i.status_group=e;this.dropdownOpen=!1,this.render();let r=this.linkedTasks.map(i=>i.issue_number).filter(i=>i!==null),o=await c({type:"UPDATE_LINKED_STATUSES",owner:this.owner,repo:this.repo,issueNumbers:r,status:t,statusGroup:e});o.ok||(this.linkedTasks.forEach((i,l)=>{i.status=s[l].status,i.status_group=s[l].group}),this.error=o.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}renderSidebar(){let t=I();if(this.root.innerHTML="",this.root.className=`tasker-root ${t?"dark":"light"}`,this.loading){this.root.innerHTML='<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>';return}if(this.error){this.root.innerHTML=`
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`,this.root.querySelector(".retry-btn")?.addEventListener("click",()=>this.init());return}if(!this.task){this.renderAddButton();return}this.renderStatusBadge()}renderAddButton(){let t=document.createElement("div");t.className="section",t.innerHTML='<div class="header">Tasker</div>';let e=document.createElement("button");e.className="add-btn",e.textContent="Add to Tasker",e.addEventListener("click",async()=>{e.disabled=!0,e.textContent="Adding...";let s=await c({type:"CREATE_TASK",owner:this.owner,repo:this.repo,number:this.number});s.ok&&s.data?(this.task=s.data,this.render()):(e.textContent=s.error??"Failed",setTimeout(()=>{e.disabled=!1,e.textContent="Add to Tasker"},2e3))}),t.appendChild(e),this.root.appendChild(t),this.renderProposalPanel()}renderStatusBadge(){let t=this.task,e=this.statuses.find(l=>l.key===t.status),s=k(e?e.color:"gray"),r=e?.label??t.status,o=document.createElement("div");o.className="section",o.innerHTML='<div class="header">Tasker</div>';let i=document.createElement("button");i.className="status-badge",i.innerHTML=`
      <span class="dot" style="background:${s}"></span>
      <span class="label">${this.escapeHtml(r)}</span>
      <span class="chevron">${this.dropdownOpen?"&#9650;":"&#9660;"}</span>
    `,i.addEventListener("click",l=>{l.stopPropagation(),this.dropdownOpen=!this.dropdownOpen,this.render()}),o.appendChild(i),this.dropdownOpen&&o.appendChild(this.renderDropdown()),this.root.appendChild(o),this.renderProposalPanel()}renderDropdown(){let t=document.createElement("div");t.className="dropdown";let e=this.groupStatuses();for(let s of E){let r=e[s];if(!r||r.length===0)continue;let o=document.createElement("div");o.className="group-label",o.textContent=C[s],t.appendChild(o);for(let i of r){let l=document.createElement("button");l.className=`status-row ${this.task?.status===i.key?"active":""}`,l.innerHTML=`
          <span class="dot" style="background:${k(i.color)}"></span>
          <span class="label">${this.escapeHtml(i.label)}</span>
        `,l.addEventListener("click",async d=>{d.stopPropagation(),await this.updateStatus(i.key,i.group_name)}),t.appendChild(l)}}return t}async updateStatus(t,e){if(!this.task)return;let s=this.task.status,r=this.task.status_group;this.task.status=t,this.task.status_group=e,this.dropdownOpen=!1,this.render();let o=await c({type:"UPDATE_STATUS",taskId:this.task.id,status:t,statusGroup:e});o.ok||(this.task.status=s,this.task.status_group=r,this.error=o.error??"Update failed",this.render(),setTimeout(()=>{this.error=null,this.render()},3e3))}hasReadyLabel(){return this.labels.some(t=>t.toLowerCase()===B)}hasRequiredDraftLabels(){let t=this.labels.map(e=>e.toLowerCase());return G.every(e=>t.includes(e))}isProposalPanelEligible(){return this.mode==="issue"}renderProposalPanel(){if(!this.isProposalPanelEligible())return;let t=document.createElement("div");t.className="section proposal",t.innerHTML='<div class="header">Proposal</div>';let e=document.createElement("div");e.className="proposal-body";let s=this.proposal?.state??"draft",r=s==="armed"||s==="posting",o=s==="posted",i=s==="failed";if(o){let n=this.proposal?.posted_at?new Date(this.proposal.posted_at).toLocaleString():"";e.innerHTML=`
        <div class="proposal-status posted">
          <span class="check">\u2713</span>
          <div>
            <div class="proposal-status-line">Posted ${this.escapeHtml(n)}</div>
            ${this.proposal?.github_comment_id?`<a class="comment-link" href="https://github.com/${this.escapeHtml(this.owner)}/${this.escapeHtml(this.repo)}/issues/${this.number}#issuecomment-${this.proposal.github_comment_id}" target="_blank" rel="noopener">View comment \u2192</a>`:""}
          </div>
        </div>
      `,t.appendChild(e),this.root.appendChild(t);return}if(this.proposalNotice){let n=document.createElement("div");n.className="proposal-notice",n.textContent=this.proposalNotice,e.appendChild(n)}if((s==="armed"||s==="posting")&&!this.autoPostEnabled){let n=document.createElement("div");n.className="proposal-notice danger",n.textContent="Auto-post is OFF in the Tasker popup \u2014 armed drafts are paused. Re-enable to post.",e.appendChild(n)}let d=this.hasReadyLabel(),h=this.hasRequiredDraftLabels();if(d){let n=document.createElement("div");n.className="proposal-notice",n.textContent=s==="armed"?'"Help Wanted" already added \u2014 posting on next poll cycle.':'"Help Wanted" is already on this issue. Arm to post immediately.',e.appendChild(n)}else if(!h){let n=document.createElement("div");n.className="proposal-notice subtle",n.textContent=this.labels.length?"Labels: "+this.labels.join(", ")+'. Will arm-and-wait for "Help Wanted".':'Labels not loaded. Will arm-and-wait for "Help Wanted" once added.',e.appendChild(n)}let p=document.createElement("textarea");p.className="proposal-textarea",p.rows=6,p.placeholder=`## Proposal

Describe your fix...`,p.value=this.proposalDraftBody,p.disabled=r||this.proposalBusy,e.appendChild(p);let g=document.createElement("div");g.className="proposal-actions";let R=()=>this.proposalDraftBody!==(this.proposal?.body??"")&&this.proposalDraftBody.trim().length>0,b=document.createElement("button");b.className="proposal-btn secondary",b.textContent=this.proposalBusy?"Saving\u2026":this.proposal?"Save changes":"Save draft",b.disabled=this.proposalBusy||r||!R(),b.addEventListener("click",()=>void this.saveProposal()),g.appendChild(b);let w=null;if(r){let n=document.createElement("button");n.className="proposal-btn",n.textContent=s==="posting"?"Posting\u2026":"Disarm",n.disabled=this.proposalBusy||s==="posting",n.addEventListener("click",()=>void this.setProposalState("draft")),g.appendChild(n)}else{let n=document.createElement("button");n.className="proposal-btn primary",n.textContent=this.proposalBusy?"Arming\u2026":"Arm auto-post";let u=R();n.disabled=this.proposalBusy||!this.proposalDraftBody.trim()||u,n.title=u?"Save changes before arming":"",n.addEventListener("click",()=>void this.setProposalState("armed")),g.appendChild(n),w=n}e.appendChild(g);let P=null;if(s!=="posting"){let n=document.createElement("div");n.className="proposal-actions";let u=document.createElement("button");u.className="proposal-btn danger",u.textContent=this.proposalBusy?"Posting\u2026":"Post now";let N=this.proposalDraftBody.trim().length>0;u.disabled=this.proposalBusy||!N,u.title=N?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.",u.addEventListener("click",()=>void this.postProposalNow()),n.appendChild(u),e.appendChild(n),P=u}p.addEventListener("input",()=>{this.proposalDraftBody=p.value;let n=R(),u=this.proposalDraftBody.trim().length>0;b.disabled=this.proposalBusy||r||!n,w&&(w.disabled=this.proposalBusy||!u||n,w.title=n?"Save changes before arming":""),P&&(P.disabled=this.proposalBusy||!u,P.title=u?"Post the current text as a comment immediately, without waiting for Help Wanted.":"Type your proposal first.")});let y=document.createElement("div");if(y.className="proposal-status-line",r)y.textContent=s==="posting"?"Posting now\u2026":'Armed \u2014 waiting for "Help Wanted" label';else if(this.proposal){let n=this.proposal.updated_at?new Date(this.proposal.updated_at).toLocaleString():"";y.textContent=`Draft saved \xB7 ${n}`}else y.textContent='Auto-posts on "Help Wanted" via the poll worker.';if(e.appendChild(y),i&&this.proposal?.last_error){let n=document.createElement("div");n.className="proposal-error",n.textContent=`Last error: ${this.proposal.last_error}`,e.appendChild(n)}t.appendChild(e),this.root.appendChild(t)}async saveProposal(){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let t=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});this.proposalBusy=!1,t.ok&&t.data?(this.proposal=t.data,this.proposalDraftBody=t.data.body):(this.error=t.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async setProposalState(t){if(this.proposalBusy)return;this.proposalBusy=!0,this.render();let e=await c({type:t==="armed"?"ARM_PROPOSAL":"DISARM_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});this.proposalBusy=!1,e.ok&&e.data?(this.proposal=e.data,e.data.state==="armed"||e.data.state==="posting"?(this.startProposalPoll(),this.startFastPath()):(this.stopProposalPoll(),this.stopFastPath())):(this.error=e.error??"Update failed",setTimeout(()=>{this.error=null,this.render()},3e3)),this.render()}async postProposalNow(){if(!(this.proposalBusy||!this.proposalDraftBody.trim())&&confirm("Post this proposal as a comment now?")){this.proposalBusy=!0,this.render();try{let e=await c({type:"SAVE_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number,body:this.proposalDraftBody});if(!e.ok||!e.data){this.error=e.error??"Save failed",setTimeout(()=>{this.error=null,this.render()},3e3);return}this.proposal=e.data,this.proposal={...this.proposal,state:"posting"},this.startProposalPoll(),this.render();let s=await c({type:"POST_PROPOSAL_NOW",proposalId:e.data.id,force:!0});s.ok&&s.data?(this.proposal=s.data,(s.data.state==="posted"||s.data.state==="failed")&&(this.stopProposalPoll(),this.stopFastPath())):(this.error=s.error??"Post failed",setTimeout(()=>{this.error=null,this.render()},5e3),this.refreshProposal())}catch(e){console.error("[tasker] postProposalNow threw",e),this.error=e instanceof Error?e.message:"Post failed (channel closed)",setTimeout(()=>{this.error=null,this.render()},5e3)}finally{this.proposalBusy=!1,this.render()}}}startProposalPoll(){this.stopProposalPoll(),this.proposalPollHandle=setInterval(()=>{this.refreshProposal()},q)}stopProposalPoll(){this.proposalPollHandle!==null&&(clearInterval(this.proposalPollHandle),this.proposalPollHandle=null)}async refreshProposal(){if(this.destroyed)return;let t=await c({type:"QUERY_PROPOSAL",owner:this.owner,repo:this.repo,number:this.number});if(this.destroyed||!t.ok||!t.data)return;let e=t.data;(!this.proposal||e.state!==this.proposal.state||e.posted_at!==this.proposal.posted_at)&&(this.proposal=e,(e.state==="posted"||e.state==="failed"||e.state==="draft")&&(this.stopProposalPoll(),this.stopFastPath()),this.render())}startFastPath(){if(this.autoPostEnabled&&!(!this.proposal||this.proposal.state!=="armed")&&!this.fastPathTriggered){if(this.hasReadyLabel()){this.tryFastPost("initial-labels");return}this.attachFastPathObservers(),this.startFastPathPoll(),this.fastPathVisibilityListener||(this.fastPathVisibilityListener=()=>{document.visibilityState==="visible"&&this.proposal?.state==="armed"?this.startFastPathPoll():this.stopFastPathPoll()},document.addEventListener("visibilitychange",this.fastPathVisibilityListener))}}stopFastPath(){this.stopFastPathPoll();for(let t of this.fastPathObservers)t.disconnect();this.fastPathObservers=[],this.fastPathVisibilityListener&&(document.removeEventListener("visibilitychange",this.fastPathVisibilityListener),this.fastPathVisibilityListener=null),this.fastPathEtag=null}attachFastPathObservers(){let t=new Set;for(let e of Y)document.querySelectorAll(e).forEach(s=>{if(t.has(s))return;t.add(s);let r=new MutationObserver(()=>this.checkLabelsContainer(s));r.observe(s,{childList:!0,subtree:!0,characterData:!0}),this.fastPathObservers.push(r),this.checkLabelsContainer(s)})}checkLabelsContainer(t){if(this.fastPathTriggered)return;(t.innerText||t.textContent||"").toLowerCase().includes(B)&&this.tryFastPost("mutation-observer")}startFastPathPoll(){this.fastPathHandle===null&&document.visibilityState==="visible"&&(this.fastPathHandle=setInterval(()=>{this.fastPollTick()},V),this.fastPollTick())}stopFastPathPoll(){this.fastPathHandle!==null&&(clearInterval(this.fastPathHandle),this.fastPathHandle=null)}async fastPollTick(){if(this.destroyed||this.fastPathTriggered)return;if(!this.proposal||this.proposal.state!=="armed"){this.stopFastPath();return}let t=await c({type:"QUERY_ISSUE_LABELS_ETAG",owner:this.owner,repo:this.repo,number:this.number,etag:this.fastPathEtag});!t.ok||!t.data||(t.data.etag&&(this.fastPathEtag=t.data.etag),!(t.data.notModified||!t.data.labels)&&(this.labels=t.data.labels,this.hasReadyLabel()&&this.tryFastPost("etag-poll")))}async tryFastPost(t){if(console.debug("[tasker] fast-post triggered via",t),this.fastPathTriggered||!this.autoPostEnabled||!this.proposal||this.proposal.state!=="armed")return;this.fastPathTriggered=!0,this.stopFastPath();let e=this.proposal.id;this.proposal={...this.proposal,state:"posting"},this.render();let s=await c({type:"POST_PROPOSAL_NOW",proposalId:e});this.destroyed||(s.ok&&s.data?(this.proposal=s.data,this.stopProposalPoll()):(this.fastPathTriggered=!1,this.refreshProposal()),this.render())}groupStatuses(){let t={todo:[],in_progress:[],complete:[]};for(let e of this.statuses)t[e.group_name]?.push(e);for(let e of E)t[e].sort((s,r)=>s.position-r.position);return t}escapeHtml(t){let e=document.createElement("span");return e.textContent=t,e.innerHTML}destroy(){this.destroyed=!0,this.stopProposalPoll(),this.stopFastPath(),this.container.remove()}getHeaderStyles(){return`
      .tasker-header {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        position: relative;
      }

      .tasker-wrapper {
        display: flex;
        align-items: center;
        gap: 0;
      }

      .tasker-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .tasker-header.light .tasker-btn {
        background: #f6f8fa;
        color: #24292f;
        border-color: #d1d9e0;
      }
      .tasker-header.light .tasker-btn:hover {
        background: #eaeef2;
      }
      .tasker-header.dark .tasker-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-header.dark .tasker-btn:hover {
        background: #292e36;
      }

      .tasker-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .tasker-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background: #2563eb;
        color: #fff;
        border-radius: 4px;
        font-weight: 800;
        font-size: 11px;
        flex-shrink: 0;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-label {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .linked-count {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        font-weight: 600;
      }
      .tasker-header.light .linked-count {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-count {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
        margin-left: 2px;
      }

      .linked-notice {
        font-size: 11px;
        padding: 6px 10px;
        font-weight: 500;
        border-radius: 4px;
        margin-bottom: 4px;
      }
      .linked-notice strong {
        font-weight: 700;
      }
      .tasker-header.light .linked-notice {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-notice {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        min-width: 220px;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 4px 24px rgba(0,0,0,0.16);
        margin-top: 4px;
        max-height: 300px;
        overflow-y: auto;
      }
      .tasker-header.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-header.dark .dropdown {
        background: #2d333b;
        border: 1px solid #3d444d;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        padding: 6px 8px 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
      }
      .tasker-header.light .status-row:hover { background: #f6f8fa; }
      .tasker-header.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .label { flex: 1; }

      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid #d1d9e0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}getSidebarStyles(){return`
      .tasker-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .tasker-root.dark { color: #e6edf3; }
      .tasker-root.light { color: #1f2328; }

      .section {
        border-top: 1px solid var(--border);
        padding-top: 16px;
        position: relative;
      }
      .tasker-root.light .section { border-color: #d1d9e0; }
      .tasker-root.dark .section { border-color: #3d444d; }

      .header {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .tasker-root.light .header { color: #1f2328; }
      .tasker-root.dark .header { color: #e6edf3; }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
        transition: background 0.1s;
      }
      .tasker-root.light .status-badge:hover { background: #f6f8fa; }
      .tasker-root.dark .status-badge:hover { background: #21262d; }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .label { flex: 1; }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
      }

      .dropdown {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.16);
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 4px;
      }
      .tasker-root.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .dropdown {
        background: #2d333b;
        border: 1px solid #3d444d;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        padding: 6px 8px 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
      }
      .tasker-root.light .status-row:hover { background: #f6f8fa; }
      .tasker-root.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .add-btn {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: 1px solid #d1d9e0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .tasker-root.dark .add-btn { border-color: #3d444d; }
      .add-btn:hover { background: #f6f8fa; }
      .tasker-root.dark .add-btn:hover { background: #21262d; }
      .add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .error-msg {
        font-size: 12px;
        color: #cf222e;
        margin-bottom: 6px;
      }
      .tasker-root.dark .error-msg { color: #f85149; }

      .retry-btn {
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid #d1d9e0;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .tasker-root.dark .retry-btn { border-color: #3d444d; }

      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: 8px 0;
      }
      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #d1d9e0;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      .section.proposal { margin-top: 8px; }

      .proposal-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
        resize: vertical;
        min-height: 80px;
        margin-bottom: 8px;
      }
      .tasker-root.light .proposal-textarea {
        background: #ffffff;
        color: #1f2328;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-textarea {
        background: #0d1117;
        color: #e6edf3;
        border: 1px solid #3d444d;
      }
      .proposal-textarea:disabled { opacity: 0.7; cursor: not-allowed; }

      .proposal-actions {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }
      .proposal-btn {
        flex: 1;
        padding: 5px 10px;
        font-size: 12px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        font-weight: 500;
      }
      .proposal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .tasker-root.light .proposal-btn {
        background: #f6f8fa;
        color: #1f2328;
        border-color: #d1d9e0;
      }
      .tasker-root.light .proposal-btn:hover:not(:disabled) {
        background: #eaeef2;
      }
      .tasker-root.dark .proposal-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-root.dark .proposal-btn:hover:not(:disabled) {
        background: #292e36;
      }
      .proposal-btn.primary {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
      }
      .proposal-btn.primary:hover:not(:disabled) { background: #1d4ed8; }

      .proposal-btn.danger {
        background: #dc2626;
        color: #ffffff;
        border-color: #dc2626;
      }
      .proposal-btn.danger:hover:not(:disabled) { background: #b91c1c; }

      .proposal-status-line {
        font-size: 11px;
        opacity: 0.7;
      }

      .proposal-notice {
        font-size: 11px;
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .tasker-root.light .proposal-notice {
        background: #fff8c5;
        color: #633c01;
        border: 1px solid #d4a72c;
      }
      .tasker-root.dark .proposal-notice {
        background: #3a2e00;
        color: #f2cc60;
        border: 1px solid #6e4f00;
      }
      .proposal-notice.subtle {
        opacity: 0.85;
      }
      .tasker-root.light .proposal-notice.danger {
        background: #ffebe9;
        color: #82071e;
        border: 1px solid #ff8182;
      }
      .tasker-root.dark .proposal-notice.danger {
        background: #5a1a1a;
        color: #ffa198;
        border: 1px solid #f85149;
      }
      .tasker-root.light .proposal-notice.subtle {
        background: #f6f8fa;
        color: #57606a;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-notice.subtle {
        background: #21262d;
        color: #8b949e;
        border: 1px solid #3d444d;
      }

      .proposal-status.posted {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
      }
      .proposal-status.posted .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #1a7f37;
        color: #fff;
        font-size: 12px;
        flex-shrink: 0;
      }
      .proposal-status.posted .comment-link {
        display: block;
        font-size: 11px;
        margin-top: 2px;
        color: inherit;
        opacity: 0.8;
      }

      .proposal-error {
        font-size: 11px;
        margin-top: 4px;
        color: #cf222e;
      }
      .tasker-root.dark .proposal-error { color: #f85149; }
    `}};var D="extensionSettings";var f={autoRefreshEnabled:!1,autoRefreshSeconds:20,notifyHelpWanted:!1,notifyChannels:["browser"],telegramChatId:"",pollSeconds:45,watchedLabelGroups:[["Help Wanted"],["Daily"],["Bug"]],excludedLabels:["DeployBlocker","DeployBlockerCash"]},j=["browser","telegram"];function Q(a){if(!Array.isArray(a))return[...f.notifyChannels];let t=a.filter(e=>typeof e=="string"&&j.includes(e));return t.length>0?Array.from(new Set(t)):[...f.notifyChannels]}function _(a,t){if(!Array.isArray(a))return[...t];let e=a.filter(s=>typeof s=="string").map(s=>s.trim()).filter(s=>s.length>0&&s.length<=64);return Array.from(new Map(e.map(s=>[s.toLowerCase(),s])).values())}function K(a){if(!Array.isArray(a))return null;let t=[];for(let e of a){if(!Array.isArray(e))continue;let s=_(e,[]);s.length>0&&t.push(s)}return t}async function A(){let t=(await chrome.storage.local.get(D))[D],e,s=K(t?.watchedLabelGroups);return s!==null?e=s:t?.watchedLabels!==void 0?e=_(t.watchedLabels,[]).map(r=>[r]):e=f.watchedLabelGroups.map(r=>[...r]),{autoRefreshEnabled:t?.autoRefreshEnabled??f.autoRefreshEnabled,autoRefreshSeconds:Math.max(5,t?.autoRefreshSeconds??f.autoRefreshSeconds),notifyHelpWanted:t?.notifyHelpWanted??f.notifyHelpWanted,notifyChannels:Q(t?.notifyChannels),telegramChatId:t?.telegramChatId??f.telegramChatId,pollSeconds:Math.max(30,t?.pollSeconds??f.pollSeconds),watchedLabelGroups:e,excludedLabels:t?.excludedLabels===void 0?[...f.excludedLabels]:_(t.excludedLabels,[])}}function U(a,t){return`seenHelpWanted:${a.toLowerCase()}/${t.toLowerCase()}`}async function $(a,t){let e=U(a,t),r=(await chrome.storage.local.get(e))[e]??[];return new Set(r)}async function z(a,t,e){let s=Array.from(e),r=s.length>500?s.slice(s.length-500):s;await chrome.storage.local.set({[U(a,t)]:r})}function X(a){return a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function F(a){let t=X(a).replace(/\s+/g,"[\\s-]?");return new RegExp(`(?:^|[^a-z0-9])${t}(?:$|[^a-z0-9])`,"i")}function J(a,t){let e=[];for(let s of t){if(s.length===0)continue;s.every(o=>F(o).test(a))&&e.push(s.join(" + "))}return e}function Z(a,t){for(let e of t)if(F(e).test(a))return!0;return!1}function tt(a,t){let e=new Map;if(a.length===0)return[];let s=new Set;document.querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]').forEach(r=>s.add(r)),s.size===0&&document.querySelectorAll('a[href*="/issues/"]').forEach(r=>{let o=r.closest('li, article, div[role="listitem"]');o&&s.add(o)});for(let r of s){let o=r.textContent??"";if(Z(o,t))continue;let i=J(o,a);if(i.length===0)continue;let l=r.querySelector('a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]');if(!l)continue;let d=l.href,h=d.match(/\/issues\/(\d+)(?:[?#].*)?$/);if(!h)continue;let p=parseInt(h[1],10);if(!Number.isFinite(p)||p<=0||e.has(p))continue;let g=(l.textContent??"").trim()||`Issue #${p}`;e.set(p,{number:p,title:g,url:d,labels:i})}return Array.from(e.values())}var T=class{constructor(t,e){this.owner=t;this.repo=e}refreshTimer=null;scanTimer=null;destroyed=!1;async init(){this.scanTimer=window.setTimeout(()=>{this.runScan(!0)},1500);let t=await A();if(t.autoRefreshEnabled){let e=Math.max(5,t.autoRefreshSeconds)*1e3;this.refreshTimer=window.setTimeout(()=>{this.destroyed||window.location.reload()},e)}}async runScan(t){if(!this.destroyed)try{let e=await A(),s=tt(e.watchedLabelGroups,e.excludedLabels),r=await $(this.owner,this.repo),o=e.notifyHelpWanted,i=s.filter(d=>!r.has(d.number));if(i.length===0)return;let l=r.size===0&&t;for(let d of i)r.add(d.number);if(await z(this.owner,this.repo,r),l||!o)return;for(let d of i.slice(0,10)){let h={type:"SEND_HELP_WANTED",owner:this.owner,repo:this.repo,number:d.number,title:d.title,url:d.url,labels:d.labels};chrome.runtime.sendMessage(h).catch(()=>{})}}catch{}}destroy(){this.destroyed=!0,this.refreshTimer!==null&&(clearTimeout(this.refreshTimer),this.refreshTimer=null),this.scanTimer!==null&&(clearTimeout(this.scanTimer),this.scanTimer=null)}};var m=null,x=null,L="";function et(){return document.querySelector('[class*="sidebarContent"]')??document.querySelector(".Layout-sidebar .BorderGrid")??null}function st(){return document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between')??null}function rt(){let a=document.querySelector(".js-comment-body")??document.querySelector('[data-testid="issue-body"]');if(!a)return[];let t=new Set,e=a.querySelectorAll('a[href*="/issues/"]');for(let o of e){let l=o.href.match(/\/issues\/(\d+)/);l&&t.add(parseInt(l[1],10))}let r=(a.textContent??"").matchAll(/#(\d{2,})/g);for(let o of r)t.add(parseInt(o[1],10));return Array.from(t)}function H(){let a=window.location.href;if(a===L)return;L=a,m&&(m.destroy(),m=null),x&&(x.destroy(),x=null);let t=O(a);if(t){x=new T(t.owner,t.repo),x.init();return}let e=M(a);if(!e)return;let s=(r=0)=>{if(e.type==="pr"){let o=st();if(!o){r<20&&setTimeout(()=>s(r+1),250);return}let i=rt();m=new v(e.owner,e.repo,e.number,"pr",i),o.appendChild(m.element),m.init()}else{let o=et();if(!o){r<20&&setTimeout(()=>s(r+1),250);return}m=new v(e.owner,e.repo,e.number,"issue",[]),o.appendChild(m.element),m.init()}};s()}H();document.addEventListener("turbo:load",()=>{L="",H()});var W=window.location.href;setInterval(()=>{window.location.href!==W&&(W=window.location.href,L="",H())},1e3);})();
