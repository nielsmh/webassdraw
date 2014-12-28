"use strict";

// Global: The canvas we're working on
var thecanvas = document.createElement("canvas");
if (!(thecanvas instanceof HTMLCanvasElement)) {
  document.getElementById("canvascontainer").innerHTML = "Your browser doesn't seem to support Canvas. Get a better browser.";
  throw "Missing Canvas support";
} else {
  document.getElementById("canvascontainer").innerHTML = "";
  document.getElementById("canvascontainer").appendChild(thecanvas);
}
var ctx = thecanvas.getContext("2d");

// Global: The current document
var drawing = null;

// Global: UI state
var currentShape = 0;
var mousePos = {x:null, y:null};
var panDragStartPoint = null;
var currentViewMatrix = [1, 0, 0, 1, 0, 0]; // Canvas.setTransform order


// Object for handling drawings

var HandleType = {
  ORIGIN: 0,
  LINE: 1,
  BEZIEREND: 2,
  BEZIERCONTROL1: 3,
  BEZIERCONTROL2: 4
};

function Drawing() {
  // Shapes is an array of Drawing.Shape objects
  this.shapes = [];
}
Drawing.prototype.toString = function () {
  var str = "";
  this.shapes.forEach(function (shape) {
    str += shape.toString().trim() + " ";
  });
  return str.trim();
}
Drawing.prototype.addShape = function (orgX, orgY) {
  var shape = new Drawing.Shape(orgX, orgY);
  this.shapes.push(shape);
  return shape;
}
Drawing.parse = function (str) {
  var reMove = /^\s*m\s*(-?\d+)\s+(-?\d+)/;
  var reLine = /^\s*l\s*(-?\d+)\s+(-?\d+)/;
  var reLineExt = /^\s+(-?\d+)\s+(-?\d+)/;
  var reBezier = /^\s*b\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/;
  var reBezierExt = /^\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/;

  var drawing = new Drawing;

  var last = "";
  var eaten = 0;
  var shape = null;
  while (str.length > 0) {
    var ps;
    if (ps = str.match(reMove)) {
      shape = drawing.addShape(parseInt(ps[1], 10), parseInt(ps[2], 10));
      last = "m";
    }
    else if (shape == null) {
      throw "Malformed drawing string, does not start with a Move command";
    }
    else if (ps = str.match(reLine) || last == "l" && (ps = str.match(reLineExt))) {
      shape.addLine(parseInt(ps[1], 10), parseInt(ps[2], 10));
      last = "l";
    }
    else if (ps = str.match(reBezier) || last == "b" && (ps == str.match(reBezierExt))) {
      shape.addBezier(
        parseInt(ps[1], 10), parseInt(ps[2], 10),
        parseInt(ps[3], 10), parseInt(ps[4], 10),
        parseInt(ps[5], 10), parseInt(ps[6], 10)
      );
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
Drawing.Shape = function(orgX, orgY) {
  // Handles is an array of {t,x,y} objects
  // t is type, see HandleType above
  // x and y are coordinates for the handle
  // One handle represents one coordinate vector involved in the shape
  this.handles = [{t: HandleType.ORIGIN, x: orgX, y: orgY}];
  // Segments is an array of numbers
  // The numbers are indices into the handles array
  // Each entry in segments indicates where a segment begins
  this.segments = [0];
}
Drawing.Shape.prototype.toString = function() {
  var letters = ["m", "l", "b", "b", "b"]; // order as HandleType values
  var str = "";
  var prevtype;
  this.handles.forEach(function (h) {
    if (h.t != prevtype) {
      str += " " + letters[h.t];
      prevtype = h.t;
    }
    str += " " + h.x + " " + h.y;
  });
  return str;
}
Drawing.Shape.prototype.addLine = function (x, y) {
  this.segments.push(this.handles.length);
  this.handles.push({t: HandleType.LINE, x: x, y: y});
}
Drawing.Shape.prototype.addBezier = function (x1, y1, x2, y2, x3, y3) {
  this.segments.push(this.handles.length);
  this.handles.push({t: HandleType.BEZIERCONTROL1, x: x1, y: y1});
  this.handles.push({t: HandleType.BEZIERCONTROL2, x: x2, y: y2});
  this.handles.push({t: HandleType.BEZIEREND,      x: x3, y: y3});
}
Drawing.Shape.prototype.removeSegment = function (segmentIdx) {
  var handleIdx = this.segments[segmentIdx];
  if (typeof handleIdx == "undefined")
    throw "Invalid segment index";
  var segmentType = this.handles[handleIdx];
  var segmentLength = 1;
  if (segmentType == HandleType.ORIGIN)
    throw "Cannot remove origin segment";
  if (segmentType == HandleType.BEZIERCONTROL1)
    segmentLength = 3;
  if (segmentType == HandleType.BEZIERCONTROL2 || segmentType == HandleType.BEZIEREND)
    throw "Segment pointing to middle of bezier definition, shape data corrupt";
  this.segments.splice(segmentIdx, 1);
  return this.handles.splice(handleIdx, segmentLength);
}
Drawing.Shape.prototype.translate = function (dx, dy) {
  this.handles.forEach(function (h) {
    h.x += dx;
    h.y += dy;
  });
}
Drawing.Shape.prototype.draw = function (ctx, doClose) {
  ctx.beginPath();
  var hi;
  var bc1, bc2;
  for (hi = 0; hi < this.handles.length; hi++) {
    var h = this.handles[hi];
    if (h.t == HandleType.ORIGIN)
      ctx.moveTo(h.x, h.y);
    else if (h.t == HandleType.LINE)
      ctx.lineTo(h.x, h.y);
    else if (h.t == HandleType.BEZIERCONTROL1)
      bc1 = h;
    else if (h.t == HandleType.BEZIERCONTROL2)
      bc2 = h;
    else if (h.t == HandleType.BEZIEREND)
      ctx.bezierCurveTo(bc1.x, bc1.y, bc2.x, bc2.y, h.x, h.y);
  }
  if (doClose)
    ctx.closePath();
}


// Painting the drawing and widgets on the canvas

var tools, capturedTool, currentTool;
function repaint() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, thecanvas.width, thecanvas.height);

  if (!drawing)
    return;

  var tool = tools[currentTool];
  if (capturedTool) tool = capturedTool;
  if (!tool) debugger;

  var vm = currentViewMatrix;

  ctx.setTransform.apply(ctx, vm);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  function drawShape(shape, isCurrent) {
    if (isCurrent && !tool.showFlattenedShape) {
      ctx.lineWidth = 2/vm[0];
      ctx.strokeStyle = "black";
      ctx.fillStyle = "#8a8";
    }
    else {
      ctx.lineWidth = 1/vm[0];
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.fillStyle = "#abc";
    }

    shape.draw(ctx, true);
    if (!tool.showFlattenedShape)
      ctx.stroke();
    ctx.fill("evenodd");
  }
  // draw other shapes first, then the current one on top
  drawing.shapes.forEach(function (shape, si) {
    if (si != currentShape)
      drawShape(shape, false);
  });
  drawShape(drawing.shapes[currentShape], true);

  // draw handles
  if (mousePos.x == null) return;
  if (tool.hideHandles) return;
  ctx.lineWidth = 1/vm[0];
  var maxDistSqr = Math.pow(110/vm[0], 2);
  var grabDistSqr = Math.pow(4/vm[0], 2);
  drawing.shapes[currentShape].handles.forEach(function (h) {
    var handleDistSqr = Math.pow(h.x-mousePos.x, 2) + Math.pow(h.y-mousePos.y, 2);
    if (handleDistSqr > maxDistSqr)
      return;

    if (handleDistSqr <= grabDistSqr) {
      ctx.fillStyle = "rgba(150,250,250,0.9)";
      ctx.strokeStyle = "rgba(60,150,150,0.7)";
    }
    else {
      ctx.fillStyle = "rgba(250,150,150,0.9)";
      ctx.strokeStyle = "rgba(150,60,60,0.7)";
    }

    ctx.beginPath();
    if (h.t == HandleType.LINE || h.t == HandleType.BEZIEREND)
      ctx.rect(h.x-2.5/vm[0], h.y-2.5/vm[3], 5/vm[0], 5/vm[3]);
    else if (h.t == HandleType.BEZIERCONTROL1 || h.t == HandleType.BEZIERCONTROL2)
      ctx.arc(h.x-0.5/vm[0], h.y-0.5/vm[0], 3/vm[0], 0, 2*Math.PI);
    else if (h.t == HandleType.ORIGIN) {
      ctx.beginPath();
      ctx.moveTo(h.x-3/vm[0], h.y);
      ctx.lineTo(h.x, h.y-3/vm[3]);
      ctx.lineTo(h.x+3/vm[0], h.y);
      ctx.lineTo(h.x, h.y+3/vm[3]);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  });
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


// Tools

function PanTool() {
  var that = this;

  var panbutton = null;
  var panstart = null;

  this.name = "Pan";
  this.id = "pan";
  this.icon = "P";

  this.init = function(prevTool) {
    // Tool was selected
    panbutton = null;
    panstart = null;
  }
  this.close = function() {
    // Tool was deselected
  }

  this.hideHandles = true;
  this.showFlattenedShape = true;

  this.mousedown = function(evt, pt) {
    // Pressed down button
    // evt is original mouse event, pt is drawing coordinate point
    if (panstart) return true;
    panbutton = evt.button;
    panstart = {x: evt.clientX, y: evt.clientY};
    return true;
  }
  this.mousemove = function(evt, pt) {
    // Moving mouse
    if (panstart) {
      var dx = evt.clientX - panstart.x;
      var dy = evt.clientY - panstart.y;
      panstart = {x: evt.clientX, y: evt.clientY};
      currentViewMatrix[4] += dx;
      currentViewMatrix[5] += dy;
      repaint();
    }
  }
  this.mouseup = function(evt, pt) {
    // Released mouse button
    if (panstart && evt.button == panbutton) {
      panstart = null;
      panbutton = null;
      return false;
    }
  }
}

function MoveShapeTool() {
  var that = this;

  var dragstart = null;

  this.name = "Move shape";
  this.id = "moveshape";
  this.icon = "D";

  this.init = function(prevTool) {
    dragstart = null;
  }
  this.close = function() { }

  this.hideHandles = true;
  this.showFlattenedShape = false;

  this.mousedown = function(evt, pt) {
    if (evt.button == 0) {
      dragstart = pt;
      return true;
    }
  }
  this.mousemove = function(evt, pt) {
    if (evt.button == 0 || (evt.buttons & 1)) {
      var dx = pt.x - dragstart.x;
      var dy = pt.y - dragstart.y;
      dragstart = pt;
      drawing.shapes[currentShape].translate(dx, dy);
      repaint();
    }
  }
  this.mouseup = function(evt, pt) {
    if (evt.button == 0) {
      dragstart = null;
      return false;
    }
  }
}

function CreateShapeTool() {
  var that = this;

  this.name = "Create shape";
  this.id = "newshape";
  this.icon = "M";

  this.init = function(prevTool) { }
  this.close = function() { }

  this.hideHandles = true;
  this.showFlattenedShape = true;

  this.mousedown = function(evt, pt) {
    if (evt.button != 0) return false;

    var shape = drawing.addShape(Math.round(pt.x), Math.round(pt.y))
    var shapenum = drawing.shapes.length - 1;
    currentShape = shapenum;
    switchTool("line");
    repaint();
    return false;
  }
  this.mousemove = function(evt, pt) { }
  this.mouseup = function(evt, pt) { }
}

function AppendLineTool() {
  var that = this;

  this.name = "Add lines";
  this.id = "line";
  this.icon = "L";

  this.init = function(prevTool) { }
  this.close = function() { }

  this.hideHandles = false;
  this.showFlattenedShape = false;

  this.mousedown = function(evt, pt) {
    if (evt.button != 0) return false;

    drawing.shapes[currentShape].addLine(Math.round(pt.x), Math.round(pt.y));
    repaint();
    return false;
  }
  this.mousemove = function(evt, pt) { }
  this.mouseup = function(evt, pt) { }
}

function AppendBezierTool() {
  var that = this;

  this.name = "Add beziers";
  this.id = "bezier";
  this.icon = "B";

  this.init = function(prevTool) { }
  this.close = function() { }

  this.hideHandles = false;
  this.showFlattenedShape = false;

  this.mousedown = function(evt, pt) {
    if (evt.button != 0) return false;

    var shape = drawing.shapes[currentShape];
    var ph = shape.handles[shape.handles.length-1];
    var vx = pt.x - ph.x;
    var vy = pt.y - ph.y;

    var x1 = Math.round(ph.x + vx/3), y1 = Math.round(ph.y + vy/3);
    var x2 = Math.round(ph.x + vx/3*2), y2 = Math.round(ph.y + vy/3*2);
    var x3 = Math.round(pt.x), y3 = Math.round(pt.y);

    shape.addBezier(x1, y1, x2, y2, x3, y3);
    repaint();
    return false;
  }
  this.mousemove = function(evt, pt) { }
  this.mouseup = function(evt, pt) { }
}

function MoveHandleTool() {
  var that = this;

  var handle;

  this.name = "Move handles";
  this.id = "movehandle";
  this.icon = "m";

  this.init = function(prevTool) {
    handle = null;
  }
  this.close = function() { }

  this.hideHandles = false;
  this.showFlattenedShape = false;

  this.mousedown = function(evt, pt) {
    if (evt.button != 0) return false;

    // find a handle to drag
    var maxDistSqr = Math.pow(3/currentViewMatrix[0], 2);
    var handles = drawing.shapes[currentShape].handles;
    for (var hi = 0; hi < handles.length; hi++) {
      var h = handles[hi];
      var distSqr = Math.pow(h.x-pt.x, 2) + Math.pow(h.y-pt.y, 2);
      if (distSqr < maxDistSqr) {
        handle = h;
        return true;
      }
    }

    return false;
  }
  this.mousemove = function(evt, pt) {
    if (handle) {
      handle.x = Math.round(pt.x);
      handle.y = Math.round(pt.y);
      repaint();
    }
  }
  this.mouseup = function(evt, pt) {
    if (handle && evt.button == 0) {
      handle = null;
    }
    return false;
  }
}

var panTool = new PanTool;
var moveHandleTool = new MoveHandleTool;
var tools = [
  panTool,
  new MoveShapeTool,
  new CreateShapeTool,
  new AppendLineTool,
  new AppendBezierTool,
  moveHandleTool
];
var currentTool = null;
var capturedTool = null;

var toolbar;
function switchTool(newTool) {
  if (typeof newTool == "string" || newTool instanceof String) {
    for (var ti = 0; ti < tools.length; ti++) {
      if (tools[ti].id == newTool) {
        newTool = ti;
        break;
      }
    }
    if (typeof newTool != "number")
      throw "Invalid tool id: " + newTool;
  }

  if (newTool < 0 || newTool >= tools.length)
    throw "Tool number out of range: " + newTool;

  var prevTool = currentTool;
  if (tools[currentTool])
    tools[currentTool].close();
  currentTool = newTool;
  tools[currentTool].init(prevTool);
  toolbar.updateActiveButton();
  repaint();
}


// Toolbar

var toolbar = new (function() {
  // Set up toolbar
  var toolbar = document.getElementById("thetoolbar");
  this.buttons = [];
  var buttons = this.buttons;
  tools.forEach(function(tool, toolnum) {
    var button = document.createElement("a");
    button.className = "toolbutton";
    button.setAttribute("title", tool.name);
    button.innerHTML = tool.icon;
    button.addEventListener("click", function() {
      switchTool(toolnum);
    });
    toolbar.appendChild(button);
    buttons.push(button);
  });

  this.updateActiveButton = function() {
    buttons.forEach(function (button, idx) {
      if (currentTool==idx)
        button.classList.add("active");
      else
        button.classList.remove("active");
    });
  };
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
  return p;
}

thecanvas.addEventListener("mousedown", function (evt) {
  var pt = canvasPointFromMouseEvent(evt);
  if (evt.button == 2) {
    if (panTool.mousedown(evt, pt))
      capturedTool = panTool;
  }
  else if (evt.shiftKey) {
    if (moveHandleTool.mousedown(evt, pt))
      capturedTool = moveHandleTool;
  }
  else {
    if (tools[currentTool].mousedown(evt, pt))
      capturedTool = tools[currentTool];
  }
}, true);

thecanvas.addEventListener("mousemove", function (evt) {
  var pt = canvasPointFromMouseEvent(evt);
  if (capturedTool) {
    capturedTool.mousemove(evt, pt);
  }
  else {
    // no tool active
    mousePos = pt;
    repaint();
  }
}, true);

thecanvas.addEventListener("mouseup", function (evt) {
  var pt = canvasPointFromMouseEvent(evt);
  if (capturedTool) {
    if (Boolean(capturedTool.mouseup(evt, pt)) != true)
      capturedTool = null;
    repaint();
  }
}, true);
thecanvas.addEventListener("contextmenu", function (evt) {
  // Prevent context menu on the canvas
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
      currentShape = (currentShape + 1) % drawing.shapes.length;
    }
    else {
      currentShape = (currentShape + drawings.shapes.length - 1) % drawing.shapes.length;
    }
    // reset the tool state
    switchTool(currentTool);
  }
  else if (evt.keyCode == 32) {
    // space, reset view
    currentViewMatrix = [1, 0, 0, 1, 0, 0];
    repaint();
  }
  else if (evt.keyCode >= 48 && evt.keyCode <= 58) {
    // number key, switch tool
    var toolid = evt.keyCode - 49;
    if (toolid < 0) toolid += 10;
    switchTool(toolid);
  }
}, true);


// Sidebar menu event handlers

document.getElementById("button-export-ass").addEventListener("click", function (evt) {
  alert(drawing.toString());
});
document.getElementById("button-load-ass").addEventListener("click", function (evt) {
  var str = prompt("Drawing string to load", "");
  if (!str) return;
  try {
    drawing = Drawing.parse(str);
    repaint();
  }
  catch (e) {
    alert("Could not load drawing: " + e);
  }
});


// Main

(function() {
  drawing = Drawing.parse("m 100 100 l 100 200 200 200 b 300 200 300 100 200 100 m 300 300 l 320 360 360 320");
  switchTool("pan");
  layoutUI();
})();
