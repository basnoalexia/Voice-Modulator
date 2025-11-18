
const canvas = document.getElementById('visualiser');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

let animationId = null;


const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');


function drawVisualizerFrame() {
  // Clear background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);


  // Draw bars like an equalizer
  const barWidth = 10;
  const barGap = 5;
  const totalBarSpace = barWidth + barGap;
  const barCount = Math.floor(WIDTH / totalBarSpace);

  for (let i = 0; i < barCount; i++) {
    // Random height to simulate changing audio levels
    const barHeight = Math.random() * (HEIGHT - 40); 

    const x = i * totalBarSpace;
    const y = HEIGHT - barHeight;

    // Bar color
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  
  animationId = requestAnimationFrame(drawVisualizerFrame);
}


function startVisualizer() {
  if (!animationId) {
    drawVisualizerFrame();
  }
}


function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
}


startBtn.addEventListener('click', startVisualizer);
stopBtn.addEventListener('click', stopVisualizer);