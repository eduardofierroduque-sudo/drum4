const AudioContext = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let masterGain, driveNode, filterNode, reverbGain;
let masterNoiseBuffer = null; 

// Parámetros por defecto
const defaultParams = { gain: 0.8, attack: 0.001, drive: 0, filter: 0, reverb: 0 };
let params = { ...defaultParams };

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0.0;
let tempo = 90;
let timerID;

const sounds = [
    { name: "KICK 1", type: "kick_hard", pattern: Array(16).fill(false) },
    { name: "KICK 2", type: "kick_soft", pattern: Array(16).fill(false) },
    { name: "SNARE", type: "snare", pattern: Array(16).fill(false) },
    { name: "HI-HAT", type: "hat", pattern: Array(16).fill(false) }
];

// --- VISUALIZADOR ---
const canvas = document.getElementById('visCanvas');
const ctxVis = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.size = Math.random() * 5 + 2; 
        this.life = 0.8; 
    }
    update(agitation) {
        this.x += this.vx * (1 + agitation);
        this.y += this.vy * (1 + agitation);
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
        
        if(agitation > 1) {
            this.size = Math.min(18, this.size * 1.1);
        } else {
            if(this.size > 5) this.size *= 0.95;
        }
    }
    draw() {
        ctxVis.fillStyle = `rgba(224, 255, 255, ${this.life})`; 
        ctxVis.beginPath();
        ctxVis.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctxVis.fill();
    }
}
for(let i=0; i<60; i++) particles.push(new Particle());

let visualAgitation = 0; 
function loopVisuals() {
    ctxVis.clearRect(0,0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(visualAgitation); p.draw(); });
    if(visualAgitation > 0) visualAgitation *= 0.9;
    requestAnimationFrame(loopVisuals);
}
loopVisuals();
function triggerVisuals() { visualAgitation = 6; }

// --- AUDIO ENGINE ---
function initAudio() {
    if (ctx) return;
    ctx = new AudioContext();

    const bufferSize = ctx.sampleRate * 2; 
    masterNoiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = masterNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    masterGain = ctx.createGain(); 
    driveNode = ctx.createWaveShaper();
    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.Q.value = 4;

    reverbGain = ctx.createGain();
    const delay = ctx.createDelay(); delay.delayTime.value = 0.08;
    const feedback = ctx.createGain(); feedback.gain.value = 0.4;

    driveNode.connect(filterNode);
    filterNode.connect(masterGain);
    filterNode.connect(delay);
    delay.connect(feedback); feedback.connect(delay);
    delay.connect(reverbGain);
    reverbGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    updateAudioEngine();
}

function updateAudioEngine() {
    if(!ctx) return;
    masterGain.gain.setTargetAtTime(params.gain, ctx.currentTime, 0.02);
    if (params.drive <= 0.01) {
        driveNode.curve = null;
    } else {
        driveNode.curve = makeDistortionCurve(params.drive);
    }
    const minF = 100, maxF = 22000;
    const targetFreq = minF * Math.pow(maxF/minF, 1 - params.filter);
    filterNode.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.05);
    reverbGain.gain.setTargetAtTime(params.reverb, ctx.currentTime, 0.05);
}

function makeDistortionCurve(amount) {
    const k = amount * 10, n = 44100, curve = new Float32Array(n), deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
        const x = i * 2 / n - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

function playSound(type, time) {
    if(!ctx) return;
    const t = time || ctx.currentTime;
    const g = ctx.createGain();
    const osc = ctx.createOscillator();
    
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + params.attack);

    if(type.includes('kick')) {
        osc.frequency.setValueAtTime(type==='kick_hard'?150:80, t);
        osc.frequency.exponentialRampToValueAtTime(30, t+0.4);
        g.gain.exponentialRampToValueAtTime(0.01, t+0.5);
        osc.connect(g); osc.start(t); osc.stop(t+0.5);
    } else if (type === 'snare') {
        osc.frequency.setValueAtTime(280, t); 
        osc.frequency.exponentialRampToValueAtTime(140, t + 0.1); 
        g.gain.linearRampToValueAtTime(1.0, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.12); 
        osc.connect(g); osc.start(t); osc.stop(t + 0.12);
        // Ruido para Snare
        const nSrc = ctx.createBufferSource(); nSrc.buffer = masterNoiseBuffer;
        const nG = ctx.createGain(); nG.gain.setValueAtTime(0.8, t);
        nG.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        nSrc.connect(nG); nG.connect(g); nSrc.start(t); nSrc.stop(t+0.1);
    } else if (type === 'hat') {
        const nSrc = ctx.createBufferSource(); nSrc.buffer = masterNoiseBuffer;
        const f = ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=7000;
        const nG = ctx.createGain(); nG.gain.setValueAtTime(0.5, t);
        nG.gain.exponentialRampToValueAtTime(0.01, t+0.05);
        nSrc.connect(f); f.connect(nG); nG.connect(g); nSrc.start(t); nSrc.stop(t+0.06);
    }

    g.connect(driveNode);
    if(time && time > ctx.currentTime) { setTimeout(triggerVisuals, (time - ctx.currentTime)*1000); } 
    else { triggerVisuals(); }
}

// --- CONTROLES UI ---
function updateKnobVisual(id, val, text) {
    const el = document.getElementById(id);
    const ptr = el.querySelector('.knob-pointer');
    const disp = el.parentElement.querySelector('.val');
    ptr.style.transform = `rotate(${-135 + (val * 270)}deg)`;
    disp.innerText = text;
}

function setupKnob(id, paramKey) {
    const el = document.getElementById(id);
    let isDragging = false, startY = 0, startVal = 0;

    el.onmousedown = (e) => {
        initAudio(); isDragging = true; startY = e.clientY; 
        startVal = params[paramKey];
        document.body.style.cursor = 'ns-resize';
    };
    window.addEventListener('mouseup', () => { isDragging = false; document.body.style.cursor = 'default'; });
    window.addEventListener('mousemove', (e) => {
        if(!isDragging) return;
        const delta = startY - e.clientY;
        let val = Math.max(0, Math.min(1, startVal + delta * 0.005));
        params[paramKey] = val;
        updateKnobVisual(id, val, paramKey === 'filter' && val === 0 ? "OFF" : Math.round(val*100)+"%");
        updateAudioEngine();
    });
}

setupKnob('driveKnob', 'drive');
setupKnob('filterKnob', 'filter');
setupKnob('reverbKnob', 'reverb');

document.getElementById('gainFader').oninput = function() { params.gain = this.value/100; updateAudioEngine(); };
document.getElementById('attackFader').oninput = function() { params.attack = 0.001 + (this.value/100)*0.2; };

// Generar Pads y Secuenciador
const padsArea = document.getElementById('padsArea');
const seqGrid = document.getElementById('seqGrid');

sounds.forEach((s,i) => {
    const p = document.createElement('div'); p.className='pad';
    p.innerHTML=`<span class="pad-txt">${s.name}</span>`;
    p.onmousedown=()=>{ initAudio(); playSound(s.type); p.classList.add('hit'); setTimeout(()=>p.classList.remove('hit'),100); };
    padsArea.appendChild(p);

    const row = document.createElement('div'); row.className='seq-row';
    row.innerHTML=`<div class="row-lbl">${s.name}</div>`;
    for(let c=0; c<16; c++) {
        const step = document.createElement('div'); step.className='step';
        step.onclick=()=>{ s.pattern[c]=!s.pattern[c]; step.classList.toggle('active'); };
        row.appendChild(step);
    }
    seqGrid.appendChild(row);
});

// Lógica Reset
document.getElementById('resetBtn').onclick = () => {
    if(isPlaying) playBtn.click();
    params = { ...defaultParams };
    document.getElementById('gainFader').value = 80;
    document.getElementById('attackFader').value = 0;
    updateKnobVisual('driveKnob', 0, "0%");
    updateKnobVisual('filterKnob', 0, "OFF");
    updateKnobVisual('reverbKnob', 0, "0%");
    sounds.forEach(s => s.pattern.fill(false));
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    updateAudioEngine();
};

// Scheduler del Secuenciador
function scheduler() {
    while(nextNoteTime < ctx.currentTime + 0.1) {
        sounds.forEach((snd, idx) => {
            if(snd.pattern[currentStep]) {
                playSound(snd.type, nextNoteTime);
                setTimeout(()=> {
                    const p=padsArea.children[idx]; p.classList.add('hit'); setTimeout(()=>p.classList.remove('hit'),100);
                }, (nextNoteTime-ctx.currentTime)*1000);
            }
        });
        const stepToVisual = currentStep;
        setTimeout(()=>{
            document.querySelectorAll('.step').forEach(s=>s.classList.remove('playing'));
            for(let r=0; r<4; r++) seqGrid.children[r].children[stepToVisual+1].classList.add('playing');
        }, (nextNoteTime-ctx.currentTime)*1000);
        
        nextNoteTime += 0.25 * (60.0 / tempo);
        currentStep = (currentStep + 1) % 16;
    }
    timerID = setTimeout(scheduler, 25);
}

const playBtn = document.getElementById('playBtn');
playBtn.onclick = () => {
    initAudio(); isPlaying = !isPlaying;
    if(isPlaying) {
        playBtn.classList.add('active'); playBtn.innerText="■ STOP";
        currentStep=0; nextNoteTime=ctx.currentTime; scheduler();
    } else {
        playBtn.classList.remove('active'); playBtn.innerText="▶ PLAY";
        clearTimeout(timerID);
    }
};
document.getElementById('bpmInput').onchange = function() { tempo = this.value; };