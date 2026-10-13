use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::{Component, Path, PathBuf};

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

pub fn safe_relative(request_path: &str) -> Option<PathBuf> {
    let trimmed = request_path.trim_start_matches('/');
    let mut out = PathBuf::new();
    for part in Path::new(trimmed).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

pub async fn serve_file(path: &Path, cache: &'static str) -> Option<Response> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let mut response = (StatusCode::OK, bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(mime_for(path)),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Some(response)
}

pub const RUNTIME_META: &str = r#"<meta name="instantnotes-runtime" content="web">"#;
const MANIFEST_LINK: &str = r#"<link rel="manifest" href="/manifest.webmanifest">"#;

pub fn mark_web(index: &str) -> String {
    match index.find("<head>") {
        Some(at) => {
            let split = at + "<head>".len();
            format!(
                "{}{}{}{}",
                &index[..split],
                RUNTIME_META,
                MANIFEST_LINK,
                &index[split..]
            )
        }
        None => format!("{RUNTIME_META}{MANIFEST_LINK}{index}"),
    }
}

async fn serve_index(ui_dir: &Path) -> Option<Response> {
    let raw = tokio::fs::read_to_string(ui_dir.join("index.html"))
        .await
        .ok()?;
    let mut response = (StatusCode::OK, mark_web(&raw)).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Some(response)
}

pub async fn serve_ui(ui_dir: &Path, request_path: &str) -> Response {
    if let Some(rel) = safe_relative(request_path) {
        if !rel.as_os_str().is_empty() {
            let full = ui_dir.join(&rel);
            let immutable = rel.starts_with("_app/immutable");
            let cache = if immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            if tokio::fs::metadata(&full)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false)
            {
                if let Some(found) = serve_file(&full, cache).await {
                    return found;
                }
            }
        }
    }
    match serve_index(ui_dir).await {
        Some(index) => index,
        None => (
            StatusCode::NOT_FOUND,
            "the web UI is not installed next to this server",
        )
            .into_response(),
    }
}

pub fn html(status: StatusCode, body: String) -> Response {
    let mut response = (status, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub const SIGN_IN: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>InstantNotes</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;--bg:#030303;--glow:#262626;--ink:#ededed;--btn:#ededed;--btn-ink:#0a0a0a}
@media (prefers-color-scheme: light){:root{--bg:#f6f6f6;--glow:#ffffff;--ink:#151515;--btn:#151515;--btn-ink:#f6f6f6}}
html,body{height:100%}
body{margin:0;overflow:hidden;color:var(--ink);background:radial-gradient(ellipse 70% 45% at 50% 0,var(--glow),var(--bg) 70%) var(--bg)}
canvas{position:fixed;inset:0;width:100%;height:100%;touch-action:none}
main{position:fixed;left:clamp(1.5rem,11vw,9rem);top:30vh}
h1{font-weight:600;font-size:clamp(2rem,4.5vw,3rem);letter-spacing:-.02em;margin:0 0 1.75rem}
a{display:inline-block;padding:.65rem 1.5rem;border-radius:.55rem;background:var(--btn);color:var(--btn-ink);text-decoration:none;font-weight:600;transition:opacity .15s}
a:hover{opacity:.85}
a:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
</style></head><body>
<script type="application/json" id="signin-data">{"notes":48}</script>
<canvas id="bg" aria-hidden="true"></canvas>
<main><h1>InstantNotes</h1><a id="go" href="/auth/login">Sign in</a></main>
<script>
(()=>{const c=document.getElementById("bg"),x=c.getContext("2d"),go=document.getElementById("go"),dark=matchMedia("(prefers-color-scheme: dark)"),still=matchMedia("(prefers-reduced-motion: reduce)"),step=22,size=14,glyphs="%$^#&*+=/01<>",TURN=48,COOL=700;
const pick=()=>dark.matches?["","#121212","#1c1c1c","#272727","#333333","#444444","#5a5a5a","#c9c9c9"]:["","#ebebeb","#e0e0e0","#d3d3d3","#c3c3c3","#b1b1b1","#999999","#3a3a3a"];let pal=pick();
const ri=n=>Math.random()*n|0,rnd=(a,b)=>a+Math.random()*(b-a),clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),lerp=(a,b,t)=>a+(b-a)*t;
const notes=(()=>{let d={};try{d=JSON.parse(document.getElementById("signin-data").textContent)}catch{}const n=d.notes;return Array.isArray(n)?n:Array.from({length:+n||0},()=>({}))})();
const seed=Math.random()*1e4,a=Math.random()*9,b=Math.random()*9;
const hash=(i,j)=>{const n=Math.sin(i*127.1+j*311.7+seed)*43758.5453;return n-Math.floor(n)};
const sm=t=>t*t*(3-2*t);
const noise=(u,v)=>{const i=Math.floor(u),j=Math.floor(v),fu=sm(u-i),fv=sm(v-j);return lerp(lerp(hash(i,j),hash(i+1,j),fu),lerp(hash(i,j+1),hash(i+1,j+1),fu),fv)};
const grain=(i,j)=>noise(i*.11,j*.11)*.65+noise(i*.31,j*.31)*.35;
let cols=0,rows=0,edge=[],bumps=null,lv=new Uint8Array(0),timer=0,wait=0,frame=0,last=null,maxLive=0,phase=0,leaving=false,finishing=false,settled=false,sweepEnd=0;
const live=new Map(),ink=new Set(),key=(i,j)=>i*rows+j;
const fill=.1+.3*(1-Math.exp(-notes.length/30));
const weight=n=>Math.sqrt(+n.size>0?+n.size:200);
const horizon=i=>rows*(1-fill)-Math.min(rows*.12,bumps[i])+Math.sin(i*.21+a+phase)*1.2+Math.sin(i*.07+b-phase*.6)*1.8+Math.sin(i*.43+a*2+phase*1.7)*.5;
const mounds=()=>{bumps=new Float32Array(cols);notes.forEach((n,q)=>{const col=hash(q,7)*cols,w=2+hash(q,3)*3,h=1+Math.min(6,weight(n)/9);for(let i=Math.max(0,col-3*w|0);i<Math.min(cols,col+3*w);i++)bumps[i]+=h*Math.exp(-(((i-col)/w)**2))})};
const seeds=()=>{ink.clear();notes.forEach((n,q)=>{const col=hash(q,7)*cols,w=2+hash(q,3)*3,m=1+Math.min(5,weight(n)/14|0);for(let s=0;s<m;s++){const i=clamp(col+(hash(q,10+s)*2-1)*w|0,0,cols-1),j=clamp(edge[i]+1+hash(q,20+s)*(bumps[i]+2)|0,0,rows-1);ink.add(key(i,j))}})};
const roll=(i,j)=>{if(ink.has(key(i,j)))return 7;const d=j-edge[i];if(d<0)return Math.random()<.07*Math.max(0,4+d)*(.5+grain(i,j))?1+ri(2):0;if(Math.random()<.07)return 0;const depth=Math.min(1,d/(rows*.38));return clamp(1+(grain(i,j)*3.2+depth*2.4+Math.random()*1.2)|0,1,6)};
const cell=(k,g)=>{const px=(k/rows|0)*step,py=k%rows*step,v=lv[k];x.clearRect(px-2,py-2,size+4,size+4);if(g&&g.ch){x.fillStyle=pal[Math.min(7,g.base+g.lift)];x.fillText(g.ch,px+size/2,py+size/2+1)}else if(v){x.fillStyle=pal[Math.min(7,v+(g?g.lift:0))];x.fillRect(px,py,size,size)}};
const all=()=>{for(let k=0;k<lv.length;k++)cell(k,live.get(k))};
const setup=()=>{const r=devicePixelRatio||1,W=innerWidth,H=innerHeight;c.width=W*r;c.height=H*r;x.setTransform(r,0,0,r,0,0);x.font="500 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";x.textAlign="center";x.textBaseline="middle";cols=Math.ceil(W/step);rows=Math.ceil(H/step);maxLive=clamp(cols*rows*.25|0,500,1500);mounds();edge=Array.from({length:cols},(_,i)=>horizon(i));seeds();lv=new Uint8Array(cols*rows);for(let k=0;k<lv.length;k++)lv[k]=roll(k/rows|0,k%rows);live.clear();all()};
const tick=()=>{phase+=.004;for(let i=0;i<cols;i++)edge[i]=horizon(i);const n=Math.max(1,cols*rows*.012|0);for(let q=0;q<n;q++){const i=ri(cols),j=q%2?ri(rows):clamp(edge[i]+rnd(-5,5)|0,0,rows-1),k=key(i,j);if(live.has(k))continue;lv[k]=roll(i,j);cell(k)}};
const run=()=>{clearInterval(timer);if(!still.matches&&!document.hidden&&!leaving)timer=setInterval(tick,140)};
const decode=(i,j,delay,turns,hot)=>{const k=key(i,j);if(live.has(k))return;live.set(k,{base:lv[k]||1,lift:0,ch:"",at:performance.now()+delay,turns,hot:!!hot});if(!frame)frame=requestAnimationFrame(loop)};
const loop=t=>{for(const[k,g]of live){if(t<g.at)continue;if(g.turns>0){g.lift=g.ch||!g.hot?2:7;g.ch=glyphs[ri(glyphs.length)];g.turns--;g.at=t+TURN}else if(g.ch&&settled){g.lift=7;g.at=Infinity}else if(g.ch){g.ch="";g.lift=1;g.at=t+COOL/2}else if(g.lift){g.lift=0;g.at=t+COOL/2}else live.delete(k);cell(k,live.get(k))}frame=live.size?requestAnimationFrame(loop):0};
const touch=(px,py)=>{if(still.matches)return;const ci=px/step,cj=py/step;for(let i=Math.max(0,Math.floor(ci-2));i<=Math.min(cols-1,ci+2);i++)for(let j=Math.max(0,Math.floor(cj-2));j<=Math.min(rows-1,cj+2);j++){if(live.size>=maxLive)return;const d=Math.hypot(i+.3-ci,j+.3-cj);if(d<=1.6&&lv[key(i,j)])decode(i,j,d*40,3+ri(3))}};
const start=()=>{if(leaving)return;leaving=true;clearInterval(timer);if(still.matches)return;const t0=performance.now();sweepEnd=t0;for(let i=0;i<cols;i++){const delay=rnd(0,400),dur=rnd(700,1500);sweepEnd=Math.max(sweepEnd,t0+delay+dur);for(let j=0;j<rows;j++)decode(i,j,delay+dur*(rows-1-j)/rows,Infinity,true)}};
const finish=href=>{if(finishing)return;finishing=true;const leave=()=>location.href=href;if(still.matches||!leaving)return leave();setTimeout(()=>{settled=true;const t=performance.now();for(const g of live.values()){g.turns=0;g.at=Math.min(g.at,t+rnd(0,350))}setTimeout(leave,500)},Math.max(0,sweepEnd-performance.now()))};
addEventListener("pointermove",e=>{const p=[e.clientX,e.clientY],[x0,y0]=last||p,n=Math.ceil(Math.hypot(p[0]-x0,p[1]-y0)/(step/2))||1;for(let q=1;q<=n;q++)touch(lerp(x0,p[0],q/n),lerp(y0,p[1],q/n));last=p});
addEventListener("pointerdown",e=>touch(e.clientX,e.clientY));
addEventListener("pointerleave",()=>{last=null});
go.addEventListener("click",e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button)return;e.preventDefault();start();if(!go.hasAttribute("data-wait"))finish(go.href)});
document.addEventListener("signin:start",start);
document.addEventListener("signin:done",e=>finish(e.detail&&e.detail.href||go.href));
setup();run();
addEventListener("resize",()=>{clearTimeout(wait);wait=setTimeout(()=>{const r=devicePixelRatio||1;if(c.width!==innerWidth*r||c.height!==innerHeight*r)setup()},150)});
dark.addEventListener("change",()=>{pal=pick();all()});still.addEventListener("change",run);document.addEventListener("visibilitychange",run)})();
</script>
</body></html>"##;

const SIGN_IN_DATA: &str =
    r#"<script type="application/json" id="signin-data">{"notes":48}</script>"#;

const SIGNED_IN_SCRIPT: &str = r#"<script>document.dispatchEvent(new Event("signin:start"));fetch("/api/count_notes",{method:"POST",headers:{"Content-Type":"application/json","X-InstantNotes":"1"},body:"{}"}).catch(()=>{}).finally(()=>document.dispatchEvent(new CustomEvent("signin:done",{detail:{href:"/"}})))</script>
</body>"#;

pub fn signed_in(sizes: &[usize]) -> String {
    let notes: Vec<String> = sizes.iter().map(|s| format!(r#"{{"size":{s}}}"#)).collect();
    let data = format!(
        r#"<script type="application/json" id="signin-data">{{"notes":[{}]}}</script>"#,
        notes.join(",")
    );
    SIGN_IN
        .replacen(SIGN_IN_DATA, &data, 1)
        .replacen("</body>", SIGNED_IN_SCRIPT, 1)
}

pub fn escape(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '&' => "&amp;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

const PAGE_STYLE: &str = ":root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center}main{text-align:center;padding:2rem;max-width:28rem}button{font:inherit;padding:.6rem 1.4rem;margin:.3rem;border-radius:.5rem;border:1px solid currentColor;background:none;color:inherit;cursor:pointer}button.primary{background:#2f6fde;border-color:#2f6fde;color:#fff}";

pub fn device_confirm(device: &str, person: &str, request: &str, csrf: &str) -> String {
    let (device, person, request, csrf) = (
        escape(device),
        escape(person),
        escape(request),
        escape(csrf),
    );
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InstantNotes</title>
<style>{PAGE_STYLE}</style></head>
<body><main><h1>Allow this device?</h1><p>Allow <strong>{device}</strong> to sync your library as <strong>{person}</strong>?</p>
<form method="post" action="/sync/v1/device/allow"><input type="hidden" name="request" value="{request}"><input type="hidden" name="csrf" value="{csrf}">
<button class="primary" name="decision" value="allow">Allow</button><button name="decision" value="deny">Cancel</button></form></main></body></html>"#
    )
}

pub fn error_page(message: &str) -> String {
    let safe = escape(message);
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>InstantNotes</title>
<style>:root{{color-scheme:light dark;font-family:system-ui,sans-serif}}body{{margin:0;min-height:100vh;display:grid;place-items:center}}main{{text-align:center;padding:2rem}}</style></head>
<body><main><h1>Sign-in did not finish</h1><p>{safe}</p><p><a href="/auth/login">Try again</a></p></main></body></html>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_in_carries_the_sizes_and_hands_off_once() {
        let page = signed_in(&[12, 0, 900]);
        assert!(page.contains(
            r#"id="signin-data">{"notes":[{"size":12},{"size":0},{"size":900}]}</script>"#
        ));
        assert!(!page.contains(SIGN_IN_DATA));
        assert_eq!(page.matches("signin:done\",{detail").count(), 1);
        assert!(page.trim_end().ends_with("</html>"));
        assert!(signed_in(&[]).contains(r#"{"notes":[]}"#));
    }
}
