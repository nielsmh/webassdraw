"use strict";

// Global: The canvas we're working on
var thecanvas = document.createElement("canvas");
var ctx = thecanvas.getContext("2d");

// Global: The current document
// Shapes the drawing consists of
var drawingShapes = new Array();
// Grabbable handles in the drawing
var drawingHandles = new Array();

// Global: UI state
var currentShape = 0;
var mousePos = {x:null, y:null};
var panDragStartPoint = null;
var currentViewMatrix = [1, 0, 0, 1, 0, 0]; // Canvas.setTransform order


// Functions to load and save drawings in ASS format

function drawingToString(drawing) {
  var str = "";
  for (var si = 0; si < drawing.length; si++) {
    var shape = drawing[si];
    str += " m " + shape.orgX + " " + shape.orgY;
    var lastSegmentType = "";
    for (var sj = 0; sj < shape.segments.length; sj++) {
      var segment = shape.segments[sj];
      if (lastSegmentType != segment.type) {
        str += " " + segment.type[0];
        lastSegmentType = segment.type;
      }
      if (segment.type == "line")
        str += " " + segment.x + " " + segment.y;
      else if (segment.type == "bezier")
        str += " " + segment.x1 + " " + segment.y1 + " " + segment.x2 + " " + segment.y2 + " " + segment.x3 + " " + segment.y3;
    }
  }
  return str.trim();
}

function stringToDrawing(str) {
  var reMove = /^\s*m\s*(-?\d+)\s+(-?\d+)/;
  var reLine = /^\s*l\s*(-?\d+)\s+(-?\d+)/;
  var reLineExt = /^\s+(-?\d+)\s+(-?\d+)/;
  var reBezier = /^\s*b\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/;
  var reBezierExt = /^\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/;

  var last = "";
  var eaten = 0;
  var drawing = new Array();
  var shape = null;
  while (str.length > 0) {
    var ps;
    if (ps = str.match(reMove)) {
      shape = {orgX: parseInt(ps[1]), orgY: parseInt(ps[2]), segments: []};
      drawing.push(shape);
      last = "m";
    }
    else if (shape == null) {
      throw "Malformed drawing string, does not start with a Move command";
    }
    else if (ps = str.match(reLine) || last == "l" && (ps = str.match(reLineExt))) {
      shape.segments.push({type: "line", x: parseInt(ps[1], 10), y: parseInt(ps[2], 10)});
      last = "l";
    }
    else if (ps = str.match(reBezier) || last == "b" && (ps == str.match(reBezierExt))) {
      shape.segments.push({type: "bezier",
        x1: parseInt(ps[1], 10), y1: parseInt(ps[2], 10),
        x2: parseInt(ps[3], 10), y2: parseInt(ps[4], 10),
        x3: parseInt(ps[5], 10), y3: parseInt(ps[6], 10),
      });
      last = "b";
    }
    else {
      throw ("Malformed drawing string, invalid command or bad parameters at position " + eaten);
    }
    eaten += ps[0].length;
    str = str.substring(ps[0].length);
  }

  return drawing;
}

function collectHandles(drawing) {
  var handles = new Array();
  for (var si = 0; si < drawing.length; si++) {
    var shape = drawing[si];
    handles.push({type: "move", x: shape.orgX, y: shape.orgY, shape: si});
    for (var sj = 0; sj < shape.segments.length; sj++) {
      var segment = shape.segments[sj];
      if (segment.type == "line") {
        handles.push({type: "line", x: segment.x, y: segment.y, shape: si, segment: sj});
      }
      else if (segment.type == "bezier") {
        handles.push({type: "bezierControl", x: segment.x1, y: segment.y1, shape: si, segment: sj, point: 1});
        handles.push({type: "bezierControl", x: segment.x2, y: segment.y2, shape: si, segment: sj, point: 2});
        handles.push({type: "bezierEnd", x: segment.x3, y: segment.y3, shape: si, segment: sj});
      }
    }
  }
  return handles;
}


// Painting the drawing and widgets on the canvas

function repaint() {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, thecanvas.width, thecanvas.height);

  var vm = currentViewMatrix;

  ctx.setTransform.apply(ctx, vm);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  function drawShape(shape, isCurrent) {
    if (isCurrent) {
      ctx.lineWidth = 2/vm[0];
      ctx.strokeStyle = "black";
      ctx.fillStyle = "#8a8";
    }
    else {
      ctx.lineWidth = 1/vm[0];
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.fillStyle = "#abc";
    }

    ctx.beginPath();
    ctx.moveTo(shape.orgX, shape.orgY);
    for (var sj = 0; sj < shape.segments.length; sj++) {
      var segment = shape.segments[sj];
      if (segment.type == "line")
        ctx.lineTo(segment.x, segment.y);
      else if (segment.type == "bezier")
        ctx.bezierCurveTo(segment.x1, segment.y1, segment.x2, segment.y2, segment.x3, segment.y3);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fill("evenodd");
  }
  // draw other shapes first, then the current one on top
  for (var si = 0; si < drawingShapes.length; si++) {
    var shape = drawingShapes[si];
    if (si != currentShape)
      drawShape(shape, false);
  }
  drawShape(drawingShapes[currentShape], true);

  // draw handles
  ctx.lineWidth = 1/vm[0];
  var maxDistSqr = Math.pow(110/vm[0], 2);
  var grabDistSqr = Math.pow(4/vm[0], 2);
  for (var hi = 0; hi < drawingHandles.length; hi++) {
    var handle = drawingHandles[hi];
    if (handle.shape != currentShape)
      continue;
    var handleDistSqr = Math.pow(handle.x-mousePos.x, 2) + Math.pow(handle.y-mousePos.y, 2);
    if (handleDistSqr > maxDistSqr)
      continue;

    if (handleDistSqr <= grabDistSqr) {
      ctx.fillStyle = "rgba(150,250,250,0.9)";
      ctx.strokeStyle = "rgba(60,150,150,0.7)";
    }
    else {
      ctx.fillStyle = "rgba(250,150,150,0.9)";
      ctx.strokeStyle = "rgba(150,60,60,0.7)";
    }

    ctx.beginPath();
    if (handle.type == "move" || handle.type == "line" || handle.type == "bezierEnd")
      ctx.rect(handle.x-2.5/vm[0], handle.y-2.5/vm[3], 6/vm[0], 6/vm[3]);
    else if (handle.type == "bezierControl")
      ctx.arc(handle.x-0.5/vm[0], handle.y-0.5/vm[0], 3/vm[0], 0, 2*Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

function layoutUI() {
  thecanvas.width = thecanvas.parentElement.clientWidth;
  thecanvas.height = thecanvas.parentElement.clientHeight;
  repaint();
}


// Modal windows

var modalbackground = new (function() {
  var that = this;

  var bg = document.createElement("div");
  bg.id = "modalbackground";

  var cancelfunction = null;

  this.show = function(show, onCancel) {
    if (show || typeof show == "undefined") {
      document.body.appendChild(bg);
      cancelfunction = onCancel;
    }
    else {
      document.body.removeChild(bg);
      cancelfunction = null;
    }
  };
  this.isActive = function() {
    return Boolean(bg.parentElement);
  };

  bg.addEventListener("click", function(evt) {
    if (cancelfunction)
      cancelfunction();
    that.show(false);
  });
})();


// Canvas-related event handlers

window.addEventListener("resize", function (evt) {
  layoutUI();
});

function canvasPointFromMouseEvent(evt) {
  var x = evt.clientX, y = evt.clientY;
  var vm = currentViewMatrix;
  var p = {
    x: (x - vm[4]) / vm[0],
    y: (y - vm[5]) / vm[3]
  };
  document.getElementById("debugview").innerHTML = p.x + ' ' + p.y
  return p;
}

thecanvas.addEventListener("mousedown", function (evt) {
  var p = canvasPointFromMouseEvent(evt);
  if (evt.button == 2) {
    // begin panning
    panDragStartPoint = {x: evt.clientX, y: evt.clientY};
    mousePos = {};
    repaint();
  }
  else if (evt.button == 0) {
    // left click, place point (for now)
    drawingShapes[currentShape].segments.push({type: "line", x: Math.round(p.x), y: Math.round(p.y)});
    drawingHandles = collectHandles(drawingShapes);
    repaint();
  }
}, true);

thecanvas.addEventListener("mousemove", function (evt) {
  var p = canvasPointFromMouseEvent(evt);
  if (evt.buttons == 2 || evt.button == 2) {
    // dragging to pan
    currentViewMatrix[4] += (evt.clientX - panDragStartPoint.x);
    currentViewMatrix[5] += (evt.clientY - panDragStartPoint.y);
    panDragStartPoint = {x: evt.clientX, y: evt.clientY};
    repaint();
  }
  else {
    // no buttons being held, update
    mousePos = p;
    repaint();
  }
}, true);

thecanvas.addEventListener("mouseup", function (evt) {
  var p = canvasPointFromMouseEvent(evt);
  if (evt.button == 2) {
    // middle click, end panning
    panDragStartPoint = null;
    mousePos = p;
    repaint();
    evt.preventDefault();
    evt.stopPropagation();
  }
}, true);
thecanvas.addEventListener("contextmenu", function (evt) {
  evt.preventDefault();
  evt.stopPropagation();
}, true);

thecanvas.addEventListener("wheel", function (evt) {
  if (evt.deltaY == 0) return;

  var p = canvasPointFromMouseEvent(evt);
  var scale;

  if (evt.deltaY > 0)
    scale = 0.9;
  else if (evt.deltaY < 0)
    scale = 1.1;

  if (scale) {
    var vm = currentViewMatrix;
    vm[0] *= scale;
    vm[3] *= scale;
    vm[4] -= p.x * vm[0] - p.x * vm[0]/scale;
    vm[5] -= p.y * vm[3] - p.y * vm[3]/scale;
    repaint();
  }
}, true);

// keyboard input (capturing handler, note third argument to addEventListener)
window.addEventListener("keydown", function (evt) {
  if (modalbackground.isActive()) return;

  function eat() { evt.preventDefault(); evt.stopPropagation(); }

  if (evt.keyCode == 9) {
    // tab, switch active shape
    eat();
    if (!evt.shiftKey) {
      currentShape = (currentShape + 1) % drawingShapes.length;
    }
    else {
      currentShape = (currentShape + drawingShapes.length - 1) % drawingShapes.length;
    }
    repaint();
  }
  else if (evt.keyCode == 32) {
    // space, reset view
    currentViewMatrix = [1, 0, 0, 1, 0, 0];
    repaint();
  }
}, true);


// Sidebar menu event handlers

document.getElementById("button-export-ass").addEventListener("click", function (evt) {
  alert(drawingToString(drawingShapes));
});
document.getElementById("button-load-ass").addEventListener("click", function (evt) {
  var str = prompt("Drawing string to load", "");
  if (!str) return;
  var drawing;
  try {
    drawing = stringToDrawing(str);
    drawingShapes = drawing;
    drawingHandles = collectHandles(drawingShapes);
    repaint();
  }
  catch (e) {
    alert("Could not load drawing: " + e);
  }
});


// Main

(function() {
  var canvascontainer = document.getElementById("canvascontainer");
  while (canvascontainer.firstChild)
    canvascontainer.removeChild(canvascontainer.firstChild);
  canvascontainer.appendChild(thecanvas);
  drawingShapes = stringToDrawing("m 100 100 l 100 200 200 200 b 300 200 300 100 200 100 m 300 300 l 320 360 360 320");
  drawingHandles = collectHandles(drawingShapes);
  layoutUI();
})();
