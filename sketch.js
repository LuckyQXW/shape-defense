let canvas;
let cannons = [];
let activeCannon = 0;
const numLanes = 5;
let enemies = [];
let shapeQueue = {0: [], 1: [], 2: [], 3: [], 4:[]};
let ammos = [];
// Used to keep track of which lane has shapes incoming
let shapeCounts = {0:0,1:0,2:0,3:0,4:0}
let lives = 3;

let isGameOver = false;
let hasGameBegun = false;
let score = 0;
let highScore = -1;
let lastHighScore = -1;
let stage = 1;
let stagesSpawnIntervals = [300, 280, 250, 220, 200, 180, 160, 140, 120, 100, 80, 60, 50, 40]
// Used to keep track of time
let lastFrameCount = 0;

let shapeClassifier;
let resultDiv;
let clearButton;
let modelReady = false;
let inputImage;
let hasStroke = false;

let serial; // the Serial object
let serialOptions = { baudRate: 115200 };
let receivedData;
let connectButton;

let bgMusic;
let hitEffect;
let loseLifeEffect;

function preload() {
  bgMusic = createAudio('assets/brave_world.wav');
  bgMusic.volume(0.5);
  hitEffect = createAudio('assets/hit.wav');
  hitEffect.volume(0.5);
  loseLifeEffect = createAudio('assets/lose_life.mp3');
  loseLifeEffect.volume(0.5);
  // set up and load ML model
  const options = {
    inputs: [64, 64, 4],
    task: 'imageClassification'
  }
  shapeClassifier = ml5.neuralNetwork(options);

  const modelDetails = {
    model: 'model/model.json',
    metadata: 'model/model_meta.json',
    weights: 'model/model.weights.bin'
  };
  shapeClassifier.load(modelDetails, modelLoaded);
}

function setup() {
  canvas = createCanvas(1000, 400);
  canvas.id("canvas");
  document.getElementById("gameboard").appendChild(document.getElementById("canvas"));
  // Setup Web Serial using serial.js
  serial = new Serial();
  serial.on(SerialEvents.CONNECTION_OPENED, onSerialConnectionOpened);
  serial.on(SerialEvents.CONNECTION_CLOSED, onSerialConnectionClosed);
  serial.on(SerialEvents.DATA_RECEIVED, onSerialDataReceived);
  serial.on(SerialEvents.ERROR_OCCURRED, onSerialErrorOccurred);

  // If we have previously approved ports, attempt to connect with them
  serial.autoConnectAndOpenPreviouslyApprovedPort(serialOptions);
  background(0);
  push();
    // Set up cannons
    translate(500, 0);
    let x = 30;
    for (let i = 0; i < numLanes; i++) {
      cannons.push(new Cannon(x, 340));
      x += 100;
    }
    resetGame();
  pop();

  clearDrawingBoard();

  inputImage = createGraphics(32, 32);
  clearButton = createButton("CLEAR");
  clearButton.mousePressed(function() {
    clearDrawingBoard();
  });
  clearButton.id("clear-btn");
  document.getElementById("gameboard").appendChild(document.getElementById("clear-btn"));
  connectButton = document.getElementById("connect-btn");
  connectButton.addEventListener('click', function() {
    if (!serial.isOpen()) {
      serial.connectAndOpen(null, serialOptions);
    } else {
      serial.close();
    }
  });
  noLoop();
}

function onSerialErrorOccurred(eventSender, error) {
}

function onSerialConnectionOpened(eventSender) {
  serialWriteTextData("-1,-1,-1,-1,-1");
  // Toggle the state of the connect button
  connectButton.classList.remove("not-connected");
  connectButton.classList.add("connected");
  connectButton.textContent = "Arduino connected. Click again to disconnect";
}

function onSerialConnectionClosed(eventSender) {
  // Toggle the state of the connect button
  connectButton.classList.remove("connected");
  connectButton.classList.add("not-connected");
  connectButton.textContent = "Click to connect to Arduino";
}

function onSerialDataReceived(eventSender, newData) {
  // Receive joystick value (-1 = left, 1 = right)
  let direction = parseInt(newData);
  activeCannon += direction;
  if (activeCannon < 0) {
    activeCannon = numLanes - 1;
  } else if (activeCannon >= numLanes) {
    activeCannon = 0;
  }
}

// Send text data over serial
function serialWriteTextData(textData) {
  if (serial.isOpen()) {
    serial.writeLine(textData);
  }
}

function clearDrawingBoard() {
  strokeWeight(0);
  fill(255);
  rect(0, 0, 400, 400);
  // Set up the dotted shape guidelines
  push();
    noFill();
    stroke(0);
    strokeWeight(5);
    rect(0, 0, 400, 400);
    canvas.drawingContext.setLineDash([2, 10]);
    stroke(100);
    strokeWeight(2);
    translate(200, 200);
    circle(0, 0, 200);
    triangle(0, -100, -100, 100, 100, 100);
    rect(-100, -100, 200, 200);
    canvas.drawingContext.setLineDash([]);
  pop();
  hasStroke = false;
}

function resetGame() {
  serialWriteTextData("-1,-1,-1,-1,-1");
  score = 0;
  lives = 3;
  shapeCounts = {0:0,1:0,2:0,3:0,4:0};
  enemies = [];
  ammos = [];
  stage = 1;
  for (let i = 0; i < numLanes; i++) {
    cannons[i].reset();
  }
  enqueueNextWave();
  isGameOver = false;
  clearDrawingBoard();
  loop();
}

function keyPressed() {
  // only start game after loading the model
  if (key == ' ' && modelReady) {
    if (isGameOver) {
      resetGame();
      bgMusic.loop();
    } else if (!hasGameBegun) {
      hasGameBegun = true;
      bgMusic.loop();
      loop();
    } else if (hasStroke) {
      classifyShape();
      clearDrawingBoard();
    }
  }
  // Enable keyboard control if Arduino is not connected
  if (!serial.isOpen()) {
    if (keyIsDown(RIGHT_ARROW)) {
      activeCannon = (activeCannon + 1) % numLanes;
    } else if (keyIsDown(LEFT_ARROW)) {
      activeCannon--;
      if (activeCannon < 0) {
        activeCannon = numLanes - 1;
      }
    }
  }
}

function draw() {
  // Game area
  push();
    translate(500, 0);
    fill(220);
    rect(0, 0, 500, 400);
    checkStage();
    checkSpawn();
    updateAmmos();
    updateEnemies();
    updateCannons();
    drawScore();
  pop();
  // Drawboard area
  strokeWeight(20);
  stroke(0);
  if (mouseIsPressed && onDrawingBoard()) {
    line(pmouseX, pmouseY, mouseX, mouseY);
    hasStroke = true;
  }
  noStroke();
}

function modelLoaded() {
  modelReady = true;
}

function classifyShape() {
  inputImage.copy(canvas, 0, 0, 400, 400, 0, 0, 32, 32 );
  shapeClassifier.classify({image: inputImage}, gotResults);
}

function gotResults(err, results) {
  if (err) {
    console.log(err);
    return;
  }
  push();
    // Add color outline to the drawboard based on predicted label
    noFill();
    strokeWeight(5);
    switch(results[0].label) {
      case 'circle':
        cannons[activeCannon].addAmmo(0);
        stroke('red')
        break;
      case 'square':
        cannons[activeCannon].addAmmo(1);
        stroke('yellow');
        break;
      case 'triangle':
        cannons[activeCannon].addAmmo(2);
        stroke('green');
        break;
    }
    rect(0, 0, 400, 400);
  pop();
}

// Returns true if the mouse is within the drawboard
function onDrawingBoard() {
  return (pmouseX > 0 && pmouseX < 400 && mouseX > 0 && mouseX < 400 &&
         pmouseY > 0 && pmouseY < 400 && mouseY > 0 && mouseY < 400);
}

function updateCannons() {
  for (let i = 0; i < numLanes; i++) {
    // Can only load active cannon
    cannons[i].setActive(activeCannon == i);
    cannons[i].draw();
    // Shoot all ammos if the lane has shape incoming
    if (shapeCounts[i] > 0) {
      cannons[i].shoot(ammos);
    }
  }
}

function updateAmmos() {
  let newAmmos = []
  for (let i = 0; i < ammos.length; i++) {
    ammos[i].update();
    for (let j = 0; j < enemies.length; j++) {
      // check if the ammo hits any shape
      if (ammos[i].overlaps(enemies[j]) && ammos[i].getShape() == enemies[j].getShape()) {
        ammos[i].setActive(false);
        enemies[j].setActive(false);
        hitEffect.play();
        shapeCounts[enemies[j].getLane()] -= 1;
        score += 100;
      }
    }
    // Only keep ammo in screen and not yet collided with any shapes
    if (ammos[i].getBottom() > 0 && ammos[i].isActive()) {
      newAmmos.push(ammos[i]);
      ammos[i].draw();
    }
  }
  ammos = newAmmos;
}

function updateEnemies() {
  let newEnemies = []
  for (let i = 0; i < enemies.length; i++) {
    enemies[i].update();
    // Only keep enemies not yet arrived at the cannon
    if (enemies[i].getBottom() < height - 60 && enemies[i].isActive()) {
      newEnemies.push(enemies[i]);
      enemies[i].draw();
    } else if (enemies[i].getBottom() >= height - 60) {
      shapeCounts[enemies[i].getLane()] -= 1;
      // Once any shape reaches a cannon, lives -1
      lives--;
      loseLifeEffect.play();
      // Send to arduino for vibration
      serialWriteTextData("b");
      if (lives == 0) {
        // Game over
        isGameOver = true;
        serialWriteTextData("-1,-1,-1,-1,-1");
        bgMusic.stop();
        lastHighScore = highScore;
        if(highScore < score){
          highScore = score;
        }
        noLoop();
      }
    }
  }
  enemies = newEnemies;
}

// Deque an enemy after certain number of frames
function checkSpawn() {
  if ((frameCount - lastFrameCount) >= stagesSpawnIntervals[stage - 1]) {
    dequeEnemy();
    lastFrameCount = frameCount;
  }
}

// Increment stage every 1000 points earned
function checkStage() {
  if (score >= stage * 1000 && stage < stagesSpawnIntervals.length) {
    stage += 1;
  }
}

function spawnEnemy(lane) {
  // Randomly pick a lane to spawn a random shape
  let type = Math.floor(random(3));
  let x = lane * 100 + 40;
  return new Enemy(x, -20, type, lane);
}

function dequeEnemy() {
  let lane = Math.floor(random(numLanes));
  let nextShape = shapeQueue[lane].shift();
  nextShape.setActive(true);
  enemies.push(nextShape);
  shapeCounts[lane] += 1;
  enqueueNextWave();
  sendShapeSequence();
}

function sendShapeSequence() {
  // Sends the next wave sequence to arduino in the format of #,#,#,#,#
  // -1: No shape
  // 0: circle
  // 1: square
  // 2: triangle
  let sequence = '';
  for (let i = 0; i < numLanes; i++) {
    sequence += shapeQueue[i][0].getShape();
    if (i != numLanes - 1) {
      sequence += ',';
    }
  }
  serialWriteTextData(sequence);
}

function enqueueNextWave() {
  for (let i = 0; i < numLanes; i++) {
    // Gets a random shape into the queue if any of them are empty
    if (shapeQueue[i].length == 0) {
      shapeQueue[i].push(spawnEnemy(i));
    }
  }
}

function drawScore() {
  // adapted from flappy bird game by Jon Froehlich: https://editor.p5js.org/jonfroehlich/sketches/shtF6XFeY
  fill(0);
  textAlign(LEFT);
  textSize(15);
  text('Score: ' + score, 10, 20);
  let stageStr = 'Stage: ' + stage;
  text(stageStr, width / 2 - textWidth(stageStr) - 100, 20);
  fill(0);
  textAlign(RIGHT);
  textSize(15);
  text('Lives: ' + lives, width / 2 - 10, 20);
  if (isGameOver) {
    // dark overlay
    fill(0, 0, 0, 100);
    rect(0, 0, width, height);

    // draw gameover text
    textAlign(CENTER);
    textSize(35);
    fill(255);
    text('GAME OVER!', width / 4, height / 3);
    
    textSize(12);
    let yText = height / 2;
    if(highScore > lastHighScore && highScore > 0) {
      text('New Hi-Score of ' + highScore + '!', width / 4, yText);
      yText += 30;
    }
    text('Press SPACE BAR to play again.', width / 4, yText);
  } else if (!hasGameBegun){
    // if we're here, then the game has yet to begin for the first time
    // dark overlay
    fill(0, 0, 0, 100);
    rect(0, 0, width, height);

    // draw game over text
    textAlign(CENTER);
    textSize(20);
    fill(255);
    let yText = height / 3;
    text('Press SPACE BAR to play!', width / 4, yText);
  }
}