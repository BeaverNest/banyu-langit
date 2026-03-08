// Investor Tags CRUD Editor — Groups, Rules, Ticker Map, Overrides
// ═══ INVESTOR TAGS EDITOR — Settings Tab ═══
var tagSubTab='groups';
var tagGroupNames=[]; // cached for dropdowns

async function renderSetTags(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  // Load group names for dropdowns
  try{var r=await fetch('/api/insider/tags/groups/all');var d=await r.json();tagGroupNames=(d.data||[]).map(function(g){return g.name;});}catch{tagGroupNames=[];}

  var h='';
  // Sub-tabs
  h+='<div style="display:flex;gap:3px;margin-bottom:12px;flex-wrap:wrap">';
  [{k:'groups',l:'👑 Groups',n:null},{k:'rules',l:'🔑 Rules',n:null},{k:'tickers',l:'📌 Ticker Map',n:null},{k:'overrides',l:'🔄 Overrides',n:null}].forEach(function(t){
    h+='<button class="bei-sort-btn'+(tagSubTab===t.k?' on':'')+'" onclick="tagSubTab=\''+t.k+'\';renderSetTags($(\'smod-content\'))" style="padding:5px 12px;font-size:11px">'+t.l+'</button>';
  });
  h+='</div>';

  h+='<div id="tag-editor-content"></div>';
  c.innerHTML=h;

  var ec=$('tag-editor-content');
  if(tagSubTab==='groups')await renderTagGroups(ec);
  else if(tagSubTab==='rules')await renderTagRules(ec);
  else if(tagSubTab==='tickers')await renderTagTickers(ec);
  else if(tagSubTab==='overrides')await renderTagOverrides(ec);
}

// ═══ GROUPS ═══
async function renderTagGroups(ec){
  try{
    var r=await fetch('/api/insider/tags/groups/all');var d=await r.json();var rows=d.data||[];
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<span style="font-size:12px;color:var(--t2)">'+rows.length+' groups</span>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="tagAddGroup()">+ Add Group</button></div>';

    // Add form (hidden by default)
    h+='<div id="tag-add-form" style="display:none;padding:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:8px;margin-bottom:10px">';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">';
    h+='<input id="tg-name" class="scr-inp" style="width:100%" placeholder="Group Name *">';
    h+='<select id="tg-cat" class="scr-sel" style="width:100%"><option value="Konglomerat">Konglomerat</option><option value="BUMN">BUMN</option><option value="BUMN Holding">BUMN Holding</option><option value="Asing">Asing</option><option value="Politik">Politik</option></select>';
    h+='<input id="tg-person" class="scr-inp" style="width:100%" placeholder="Key Person">';
    h+='<input id="tg-tickers" class="scr-inp" style="width:100%" placeholder="Tickers (BBCA,BBRI)">';
    h+='</div>';
    h+='<input id="tg-desc" class="scr-inp" style="width:100%;margin-bottom:8px" placeholder="Description">';
    h+='<div style="display:flex;gap:6px"><button class="bei-tab on" style="font-size:11px" onclick="tagSaveGroup()">💾 Save</button>';
    h+='<button class="bei-tab" style="font-size:11px" onclick="$(\'tag-add-form\').style.display=\'none\'">Cancel</button></div>';
    h+='<input id="tg-edit-id" type="hidden" value="">';
    h+='</div>';

    if(!rows.length){h+='<div style="color:var(--t3);text-align:center;padding:20px">No groups yet</div>';ec.innerHTML=h;return;}

    // Group by category
    var cats={};rows.forEach(function(r){var c=r.category||'Other';if(!cats[c])cats[c]=[];cats[c].push(r);});

    Object.keys(cats).sort().forEach(function(cat){
      h+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--b1)">'+esc(cat)+' ('+cats[cat].length+')</div>';
      cats[cat].forEach(function(g){
        h+='<div class="s-row" style="cursor:default;padding:8px 12px">';
        h+='<div class="s-row-info" style="flex:1;min-width:0">';
        h+='<div style="font-weight:600;font-size:12px">'+esc(g.name)+'</div>';
        h+='<div style="font-size:10px;color:var(--t3);display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">';
        if(g.key_person)h+='<span>👤 '+esc(g.key_person)+'</span>';
        if(g.tickers)h+='<span>📌 '+esc(g.tickers)+'</span>';
        if(g.description)h+='<span>'+esc(g.description)+'</span>';
        h+='</div></div>';
        h+='<div style="display:flex;gap:4px;flex-shrink:0">';
        h+='<button class="s-ca-btn" onclick="tagEditGroup('+g.id+',\''+esc(g.name).replace(/'/g,"\\'")+'\',\''+esc(g.category||'')+'\',\''+esc(g.key_person||'').replace(/'/g,"\\'")+'\',\''+esc(g.tickers||'').replace(/'/g,"\\'")+'\',\''+esc(g.description||'').replace(/'/g,"\\'")+'\')">✏️</button>';
        h+='<button class="s-ca-btn dismiss" onclick="tagDeleteGroup('+g.id+')">🗑</button>';
        h+='</div></div>';
      });
    });
    ec.innerHTML=h;
  }catch(e){ec.innerHTML='<div style="color:var(--rd)">Error: '+e.message+'</div>';}
}

function tagAddGroup(){
  $('tag-add-form').style.display='';
  $('tg-edit-id').value='';$('tg-name').value='';$('tg-cat').value='Konglomerat';
  $('tg-person').value='';$('tg-tickers').value='';$('tg-desc').value='';
  $('tg-name').focus();
}

function tagEditGroup(id,name,cat,person,tickers,desc){
  $('tag-add-form').style.display='';
  $('tg-edit-id').value=id;$('tg-name').value=name;$('tg-cat').value=cat||'Konglomerat';
  $('tg-person').value=person;$('tg-tickers').value=tickers;$('tg-desc').value=desc;
  $('tg-name').focus();
}

async function tagSaveGroup(){
  var id=$('tg-edit-id').value;var name=$('tg-name').value.trim();
  if(!name){showT('⚠','Name required');return;}
  var body={name:name,category:$('tg-cat').value,key_person:$('tg-person').value,tickers:$('tg-tickers').value,description:$('tg-desc').value};
  try{
    var url=id?'/api/insider/tags/groups/'+id:'/api/insider/tags/groups';
    var method=id?'PUT':'POST';
    await fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    showT('✅',id?'Updated':'Added');
    renderSetTags($('smod-content'));
  }catch(e){showT('Error',e.message);}
}

async function tagDeleteGroup(id){
  if(!confirm('Delete this group?'))return;
  try{await fetch('/api/insider/tags/groups/'+id,{method:'DELETE'});showT('✅','Deleted');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}
}

// ═══ RULES ═══
async function renderTagRules(ec){
  try{
    var r=await fetch('/api/insider/tags/rules/all');var d=await r.json();var rows=d.data||[];
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<span style="font-size:12px;color:var(--t2)">'+rows.length+' rules</span>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="tagAddRule()">+ Add Rule</button></div>';

    h+='<div id="tag-rule-form" style="display:none;padding:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:8px;margin-bottom:10px">';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
    h+='<input id="tr-kw" class="scr-inp" style="width:160px" placeholder="Keyword *">';
    h+='<select id="tr-mt" class="scr-sel" style="width:120px"><option value="contains">contains</option><option value="starts_with">starts_with</option><option value="exact">exact</option></select>';
    h+='<select id="tr-gn" class="scr-sel" style="width:200px"><option value="">Select Group *</option>'+tagGroupNames.map(function(g){return'<option value="'+esc(g)+'">'+esc(g)+'</option>';}).join('')+'</select>';
    h+='<input id="tr-notes" class="scr-inp" style="flex:1;min-width:100px" placeholder="Notes">';
    h+='</div>';
    h+='<div style="display:flex;gap:6px"><button class="bei-tab on" style="font-size:11px" onclick="tagSaveRule()">💾 Save</button>';
    h+='<button class="bei-tab" style="font-size:11px" onclick="$(\'tag-rule-form\').style.display=\'none\'">Cancel</button></div>';
    h+='<input id="tr-edit-id" type="hidden" value="">';
    h+='</div>';

    if(!rows.length){h+='<div style="color:var(--t3);text-align:center;padding:20px">No rules yet</div>';ec.innerHTML=h;return;}

    h+='<div style="overflow-y:auto;max-height:calc(80vh - 280px)"><table class="s-ca-tbl"><thead><tr><th>Keyword</th><th>Match</th><th>Group</th><th>Notes</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(r){
      h+='<tr><td style="font-weight:600">'+esc(r.keyword)+'</td>';
      h+='<td style="font-size:10px;color:var(--t3)">'+esc(r.match_type)+'</td>';
      h+='<td><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(139,92,246,.12);color:#8b5cf6">'+esc(r.group_name)+'</span></td>';
      h+='<td style="font-size:10px;color:var(--t3);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.notes||'')+'</td>';
      h+='<td style="white-space:nowrap"><button class="s-ca-btn" onclick="tagEditRule('+r.id+',\''+esc(r.keyword).replace(/'/g,"\\'")+'\',\''+esc(r.match_type)+'\',\''+esc(r.group_name).replace(/'/g,"\\'")+'\',\''+esc(r.notes||'').replace(/'/g,"\\'")+'\')">✏️</button> ';
      h+='<button class="s-ca-btn dismiss" onclick="tagDeleteRule('+r.id+')">🗑</button></td></tr>';
    });
    h+='</tbody></table></div>';
    ec.innerHTML=h;
  }catch(e){ec.innerHTML='<div style="color:var(--rd)">Error: '+e.message+'</div>';}
}

function tagAddRule(){$('tag-rule-form').style.display='';$('tr-edit-id').value='';$('tr-kw').value='';$('tr-mt').value='contains';$('tr-gn').value='';$('tr-notes').value='';$('tr-kw').focus();}
function tagEditRule(id,kw,mt,gn,notes){$('tag-rule-form').style.display='';$('tr-edit-id').value=id;$('tr-kw').value=kw;$('tr-mt').value=mt;$('tr-gn').value=gn;$('tr-notes').value=notes;$('tr-kw').focus();}

async function tagSaveRule(){
  var id=$('tr-edit-id').value;var kw=$('tr-kw').value.trim();var gn=$('tr-gn').value;
  if(!kw||!gn){showT('⚠','Keyword + Group required');return;}
  var body={keyword:kw,match_type:$('tr-mt').value,group_name:gn,notes:$('tr-notes').value};
  try{await fetch(id?'/api/insider/tags/rules/'+id:'/api/insider/tags/rules',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});showT('✅',id?'Updated':'Added');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}
}
async function tagDeleteRule(id){if(!confirm('Delete?'))return;try{await fetch('/api/insider/tags/rules/'+id,{method:'DELETE'});showT('✅','Deleted');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}}

// ═══ TICKER MAP ═══
async function renderTagTickers(ec){
  try{
    var r=await fetch('/api/insider/tags/tickers/all');var d=await r.json();var rows=d.data||[];
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<span style="font-size:12px;color:var(--t2)">'+rows.length+' mappings</span>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="tagAddTicker()">+ Add Ticker</button></div>';

    h+='<div id="tag-ticker-form" style="display:none;padding:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:8px;margin-bottom:10px">';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px">';
    h+='<input id="tt-ticker" class="scr-inp" style="width:100px;text-transform:uppercase" placeholder="BBCA *">';
    h+='<select id="tt-gn" class="scr-sel" style="width:200px"><option value="">Select Group *</option>'+tagGroupNames.map(function(g){return'<option value="'+esc(g)+'">'+esc(g)+'</option>';}).join('')+'</select>';
    h+='<select id="tt-cat" class="scr-sel" style="width:140px"><option value="Konglomerat">Konglomerat</option><option value="BUMN">BUMN</option><option value="BUMN Holding">BUMN Holding</option></select>';
    h+='</div>';
    h+='<div style="display:flex;gap:6px"><button class="bei-tab on" style="font-size:11px" onclick="tagSaveTicker()">💾 Save</button>';
    h+='<button class="bei-tab" style="font-size:11px" onclick="$(\'tag-ticker-form\').style.display=\'none\'">Cancel</button></div>';
    h+='<input id="tt-edit-id" type="hidden" value="">';
    h+='</div>';

    if(!rows.length){h+='<div style="color:var(--t3);text-align:center;padding:20px">No mappings yet</div>';ec.innerHTML=h;return;}

    // Group by group_name
    var byGroup={};rows.forEach(function(r){var g=r.group_name||'Other';if(!byGroup[g])byGroup[g]=[];byGroup[g].push(r);});

    h+='<div style="overflow-y:auto;max-height:calc(80vh - 280px)">';
    Object.keys(byGroup).sort().forEach(function(g){
      var tickers=byGroup[g];
      h+='<div style="padding:6px 0;border-bottom:1px solid var(--b1)">';
      h+='<div style="font-size:11px;font-weight:600;color:var(--bl);margin-bottom:4px">'+esc(g)+' <span style="color:var(--t3);font-weight:400">('+tickers.length+')</span></div>';
      h+='<div style="display:flex;gap:4px;flex-wrap:wrap">';
      tickers.forEach(function(t){
        h+='<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bgH);border:1px solid var(--b2);font-family:var(--fm);display:inline-flex;align-items:center;gap:4px">';
        h+=esc(t.ticker);
        h+='<button style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:10px;padding:0" onclick="tagDeleteTicker('+t.id+')" title="Remove">✕</button>';
        h+='</span>';
      });
      h+='</div></div>';
    });
    h+='</div>';
    ec.innerHTML=h;
  }catch(e){ec.innerHTML='<div style="color:var(--rd)">Error: '+e.message+'</div>';}
}

function tagAddTicker(){$('tag-ticker-form').style.display='';$('tt-edit-id').value='';$('tt-ticker').value='';$('tt-gn').value='';$('tt-cat').value='Konglomerat';$('tt-ticker').focus();}

async function tagSaveTicker(){
  var id=$('tt-edit-id').value;var ticker=$('tt-ticker').value.trim().toUpperCase();var gn=$('tt-gn').value;
  if(!ticker||!gn){showT('⚠','Ticker + Group required');return;}
  // Support comma-separated tickers
  var tickers=ticker.split(',').map(function(t){return t.trim();}).filter(Boolean);
  try{
    for(var i=0;i<tickers.length;i++){
      await fetch(id?'/api/insider/tags/tickers/'+id:'/api/insider/tags/tickers',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker:tickers[i],group_name:gn,category:$('tt-cat').value})});
      if(id)break; // edit mode = single
    }
    showT('✅','Added '+tickers.length+' ticker(s)');renderSetTags($('smod-content'));
  }catch(e){showT('Error',e.message);}
}
async function tagDeleteTicker(id){try{await fetch('/api/insider/tags/tickers/'+id,{method:'DELETE'});showT('✅','Removed');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}}

// ═══ OVERRIDES ═══
async function renderTagOverrides(ec){
  try{
    var r=await fetch('/api/insider/tags/overrides/all');var d=await r.json();var rows=d.data||[];
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<span style="font-size:12px;color:var(--t2)">'+rows.length+' overrides</span>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="tagAddOverride()">+ Add Override</button></div>';

    h+='<div id="tag-override-form" style="display:none;padding:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:8px;margin-bottom:10px">';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
    h+='<input id="to-name" class="scr-inp" style="flex:1;min-width:200px" placeholder="Investor Name (exact match) *">';
    h+='<select id="to-gn" class="scr-sel" style="width:200px"><option value="">Select Group *</option>'+tagGroupNames.map(function(g){return'<option value="'+esc(g)+'">'+esc(g)+'</option>';}).join('')+'</select>';
    h+='<input id="to-notes" class="scr-inp" style="width:150px" placeholder="Notes">';
    h+='</div>';
    h+='<div style="display:flex;gap:6px"><button class="bei-tab on" style="font-size:11px" onclick="tagSaveOverride()">💾 Save</button>';
    h+='<button class="bei-tab" style="font-size:11px" onclick="$(\'tag-override-form\').style.display=\'none\'">Cancel</button></div>';
    h+='<input id="to-edit-id" type="hidden" value="">';
    h+='</div>';

    if(!rows.length){h+='<div style="color:var(--t3);text-align:center;padding:20px">No overrides yet. Use this for investor names that get incorrectly tagged by keyword rules.</div>';ec.innerHTML=h;return;}

    h+='<div style="overflow-y:auto;max-height:calc(80vh - 280px)"><table class="s-ca-tbl"><thead><tr><th>Investor Name</th><th>Assigned Group</th><th>Notes</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(r){
      h+='<tr><td style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.investor_name)+'">'+esc(r.investor_name)+'</td>';
      h+='<td><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(139,92,246,.12);color:#8b5cf6">'+esc(r.group_name)+'</span></td>';
      h+='<td style="font-size:10px;color:var(--t3)">'+esc(r.notes||'')+'</td>';
      h+='<td style="white-space:nowrap"><button class="s-ca-btn" onclick="tagEditOverride('+r.id+',\''+esc(r.investor_name).replace(/'/g,"\\'")+'\',\''+esc(r.group_name).replace(/'/g,"\\'")+'\',\''+esc(r.notes||'').replace(/'/g,"\\'")+'\')">✏️</button> ';
      h+='<button class="s-ca-btn dismiss" onclick="tagDeleteOverride('+r.id+')">🗑</button></td></tr>';
    });
    h+='</tbody></table></div>';
    ec.innerHTML=h;
  }catch(e){ec.innerHTML='<div style="color:var(--rd)">Error: '+e.message+'</div>';}
}

function tagAddOverride(){$('tag-override-form').style.display='';$('to-edit-id').value='';$('to-name').value='';$('to-gn').value='';$('to-notes').value='';$('to-name').focus();}
function tagEditOverride(id,name,gn,notes){$('tag-override-form').style.display='';$('to-edit-id').value=id;$('to-name').value=name;$('to-gn').value=gn;$('to-notes').value=notes;$('to-name').focus();}

async function tagSaveOverride(){
  var id=$('to-edit-id').value;var name=$('to-name').value.trim();var gn=$('to-gn').value;
  if(!name||!gn){showT('⚠','Name + Group required');return;}
  try{await fetch(id?'/api/insider/tags/overrides/'+id:'/api/insider/tags/overrides',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({investor_name:name,group_name:gn,notes:$('to-notes').value})});showT('✅',id?'Updated':'Added');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}
}
async function tagDeleteOverride(id){if(!confirm('Delete?'))return;try{await fetch('/api/insider/tags/overrides/'+id,{method:'DELETE'});showT('✅','Deleted');renderSetTags($('smod-content'));}catch(e){showT('Error',e.message);}}
