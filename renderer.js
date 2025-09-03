// renderer.js — handles PDF rendering + Fabric annotation layer + notes
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.js';

const openBtn = document.getElementById('openBtn');
const toolSel = document.getElementById('tool');
const colorPicker = document.getElementById('colorPicker');
const sizeRange = document.getElementById('size');
const addNoteBtn = document.getElementById('addNote');
const savePNG = document.getElementById('savePNG');

const pdfCanvas = document.getElementById('pdf-canvas');
const viewer = document.getElementById('viewer');
const annotationCanvasEl = document.getElementById('annotation-canvas');

let fabricCanvas;
let currentPDF = null;
let currentPageNum = 1;
let pageScale = 1.25;

function initFabric(w,h){
  annotationCanvasEl.width = w;
  annotationCanvasEl.height = h;
  annotationCanvasEl.style.width = w + 'px';
  annotationCanvasEl.style.height = h + 'px';
  if (fabricCanvas) fabricCanvas.dispose();
  fabricCanvas = new fabric.Canvas('annotation-canvas', {
    isDrawingMode: true,
    backgroundColor: 'rgba(0,0,0,0)'
  });

  // configure drawing brush
  updateBrush();

  // pointer smoothing: use pencilBrush with width jitter (gives natural strokes)
  fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);

  // allow object selection
  fabricCanvas.on('mouse:down', function(){
    if (toolSel.value === 'select') fabricCanvas.isDrawingMode = false;
  });
}

function updateBrush(){
  if (!fabricCanvas) return;
  const col = colorPicker.value;
  const size = parseInt(sizeRange.value,10);
  if (toolSel.value === 'highlighter'){
    fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.width = size * 3; // thicker
    fabricCanvas.freeDrawingBrush.color = col;
    fabricCanvas.freeDrawingBrush.opacity = 0.25; // translucent for highlighter feel
    // make strokes a bit jittery / textured
  } else if (toolSel.value === 'pen'){
    fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
    fabricCanvas.freeDrawingBrush.width = size;
    fabricCanvas.freeDrawingBrush.color = col;
    fabricCanvas.freeDrawingBrush.opacity = 1.0;
  } else if (toolSel.value === 'eraser'){
    // simple "eraser" by drawing transparent stroke using globalCompositeOperation-like trick:
    fabricCanvas.isDrawingMode = true;
    const eraser = new fabric.PencilBrush(fabricCanvas);
    eraser.width = size * 3;
    eraser.color = 'rgba(0,0,0,1)';
    // simulate eraser by removing overlapping objects on mouse:up
    fabricCanvas.freeDrawingBrush = eraser;
  }
  fabricCanvas.isDrawingMode = (toolSel.value !== 'select');
}

toolSel.addEventListener('change', updateBrush);
colorPicker.addEventListener('change', updateBrush);
sizeRange.addEventListener('input', updateBrush);

openBtn.addEventListener('click', async () => {
  const res = await window.electronAPI.showOpenDialog();
  if (res && res.filePaths && res.filePaths.length){
    const file = res.filePaths[0];
    if (file.toLowerCase().endsWith('.pdf')){
      loadPDF(file);
    } else {
      loadImage(file);
    }
  }
});

async function loadPDF(path){
  const loadingTask = pdfjsLib.getDocument(path);
  const pdf = await loadingTask.promise;
  currentPDF = pdf;
  currentPageNum = 1;
  renderPage(currentPageNum);
}

async function renderPage(pageNum){
  const page = await currentPDF.getPage(pageNum);
  const viewport = page.getViewport({ scale: pageScale });
  const canvas = pdfCanvas;
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';

  const renderContext = { canvasContext: context, viewport: viewport };
  await page.render(renderContext).promise;

  // place the PDF canvas into viewer and init fabric overlay same size:
  // use the image data as background
  const dataURL = canvas.toDataURL();
  viewer.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataURL;
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  viewer.appendChild(img);

  // create overlay canvas on top
  const overlay = annotationCanvasEl;
  overlay.width = viewport.width;
  overlay.height = viewport.height;
  overlay.style.width = viewport.width + 'px';
  overlay.style.height = viewport.height + 'px';
  viewer.appendChild(overlay);
  initFabric(viewport.width, viewport.height);

  // put a background image in fabric for easy export/flatten later
  fabric.Image.fromURL(dataURL, function(imgObj){
    fabricCanvas.setBackgroundImage(imgObj, fabricCanvas.renderAll.bind(fabricCanvas));
  }, { originX:'left', originY:'top' });
}

function loadImage(path){
  // render image as background, similar to PDF flow (simple)
  const img = new Image();
  img.onload = () => {
    const w = img.width, h = img.height;
    viewer.innerHTML = '';
    viewer.appendChild(img);
    img.style.maxWidth = '100%';
    img.style.height = 'auto';

    const overlay = annotationCanvasEl;
    overlay.width = w;
    overlay.height = h;
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    viewer.appendChild(overlay);
    initFabric(w,h);

    fabric.Image.fromURL(img.src, function(imgObj){
      fabricCanvas.setBackgroundImage(imgObj, fabricCanvas.renderAll.bind(fabricCanvas));
    }, { originX:'left', originY:'top' });
  };
  img.src = path;
}

// Sticky notes: a colored rect + editable text in handwriting font
addNoteBtn.addEventListener('click', () => {
  const noteWidth = 220;
  const noteHeight = 140;
  const rect = new fabric.Rect({
    width: noteWidth, height: noteHeight, fill: '#fff590', rx: 8, ry: 8, stroke: '#d7c85b', strokeWidth:2
  });
  const text = new fabric.Textbox('New note', {
    width: noteWidth - 20,
    left: 10, top: 10,
    fontFamily: "'Patrick Hand', 'Segoe UI', sans-serif",
    fontSize: 18,
    editable: true
  });
  const group = new fabric.Group([rect, text], { left: 50, top: 50, cornerStyle: 'circle', padding:6 });
  group.set('hasRotatingPoint', false);
  group.setControlsVisibility({ mtr: false }); // disable rotate
  fabricCanvas.add(group).setActiveObject(group);
  updateNotesList();
});

function updateNotesList(){
  const list = document.getElementById('notesList');
  list.innerHTML = '';
  fabricCanvas.getObjects().forEach((obj, i) => {
    if (obj.type === 'group'){
      const div = document.createElement('div');
      div.className = 'sticky';
      div.style.background = obj.item(0).fill || '#fff590';
      div.textContent = obj._objects && obj._objects[1] ? obj._objects[1].text : 'note';
      div.addEventListener('click', ()=> {
        fabricCanvas.setActiveObject(obj);
      });
      list.appendChild(div);
    }
  });
}

fabric.Canvas.prototype.toImageWithAnnotations = function() {
  // returns dataURL of flattened canvas (background image + annotations)
  return this.toDataURL({
    format: 'png',
    multiplier: 1
  });
};

savePNG.addEventListener('click', () => {
  const dataUrl = fabricCanvas.toImageWithAnnotations();
  // trigger download
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'annotated_page.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
});
