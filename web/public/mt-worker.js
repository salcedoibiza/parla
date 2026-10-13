// Traductor dentro del dispositivo: Bergamot (Marian NMT compilado a WebAssembly) con los
// modelos de Firefox Translations de Mozilla. Funciona sin internet una vez descargado el idioma.
//
// Adaptado de translator-worker.js de bergamot-translator (Mozilla Public License 2.0):
// https://github.com/browsermt/bergamot-translator
'use strict';

var Module = {};
self.Module = Module;

var GEMM_FALLBACKS = {
  int8_prepare_a: 'int8PrepareAFallback',
  int8_prepare_b: 'int8PrepareBFallback',
  int8_prepare_b_from_transposed: 'int8PrepareBFromTransposedFallback',
  int8_prepare_b_from_quantized_transposed: 'int8PrepareBFromQuantizedTransposedFallback',
  int8_prepare_bias: 'int8PrepareBiasFallback',
  int8_multiply_and_add_bias: 'int8MultiplyAndAddBiasFallback',
  int8_select_columns_of_b: 'int8SelectColumnsOfBFallback',
};

function fallbackGemm() {
  var out = {};
  Object.keys(GEMM_FALLBACKS).forEach(function (name) {
    var target = GEMM_FALLBACKS[name];
    out[name] = function () {
      return Module.asm[target].apply(null, arguments);
    };
  });
  return out;
}

var service = null;
var models = new Map();
var workspace = 64;

function memBytes() {
  try { return Module.HEAP8 ? Module.HEAP8.length : 0; } catch (e) { return 0; }
}

// La página le pasa el código del motor y el binario WebAssembly (así el hilo no descarga nada,
// lo que evita problemas en la app de Android).
async function init(args) {
  if (service) return { mem: memBytes() };
  if (args.workspace) workspace = args.workspace;
  await new Promise(function (resolve, reject) {
    Module.instantiateWasm = function (info, accept) {
      var imports = Object.assign({}, info, { wasm_gemm: fallbackGemm() });
      WebAssembly.instantiate(args.wasm, imports).then(function (r) { accept(r.instance); }).catch(reject);
      return {};
    };
    Module.onRuntimeInitialized = function () { resolve(); };
    Module.onAbort = function (what) { reject(new Error('abort: ' + what)); };
    try {
      var url = URL.createObjectURL(new Blob([args.glue], { type: 'text/javascript' }));
      importScripts(url);
      URL.revokeObjectURL(url);
    } catch (err) {
      reject(err);
    }
  });
  service = new Module.BlockingService({ cacheSize: 0 });
  return { mem: memBytes() };
}

function aligned(buffer, alignment) {
  var bytes = new Int8Array(buffer);
  var memory = new Module.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(bytes);
  return memory;
}

function yaml(config) {
  return Object.keys(config).map(function (k) { return k + ': ' + config[k]; }).join('\n') + '\n';
}

function load(args) {
  if (models.has(args.key)) return { mem: memBytes() };
  var vocabs = new Module.AlignedMemoryList();
  args.vocabs.forEach(function (b) { vocabs.push_back(aligned(b, 64)); });
  var config = {
    'beam-size': 1,
    normalize: 1.0,
    'word-penalty': 0,
    'cpu-threads': 0,
    'gemm-precision': /intgemm8\.bin$/.test(args.modelName) ? 'int8shiftAll' : 'int8shiftAlphaAll',
    'skip-cost': true,
    alignment: 'soft',
    quiet: true,
    'quiet-translation': true,
    'max-length-break': 128,
    'mini-batch-words': 1024,
    workspace: workspace,
    'max-length-factor': 2.0,
  };
  if (args.extra) Object.keys(args.extra).forEach(function (k) { config[k] = args.extra[k]; });
  models.set(args.key, new Module.TranslationModel(yaml(config), aligned(args.model, 256), aligned(args.lex, 64), vocabs, null));
  return { mem: memBytes() };
}

function free(args) {
  var m = models.get(args.key);
  if (m) {
    models.delete(args.key);
    m.delete();
  }
  return { mem: memBytes() };
}

function translate(args) {
  var input = new Module.VectorString();
  args.texts.forEach(function (t) { input.push_back(t); });
  var options = new Module.VectorResponseOptions();
  args.texts.forEach(function () { options.push_back({ alignment: false, html: false, qualityScores: false }); });
  var route = args.route.map(function (k) {
    var m = models.get(k);
    if (!m) throw new Error('not loaded: ' + k);
    return m;
  });
  var t0 = Date.now();
  var res = route.length > 1
    ? service.translateViaPivoting(route[0], route[1], input, options)
    : service.translate(route[0], input, options);
  var out = [];
  for (var i = 0; i < args.texts.length; i++) out.push(res.get(i).getTranslatedText());
  input.delete();
  options.delete();
  res.delete();
  return { texts: out, ms: Date.now() - t0 };
}

var handlers = { init: init, load: load, free: free, translate: translate };

self.addEventListener('message', async function (ev) {
  var id = ev.data.id;
  try {
    var h = handlers[ev.data.name];
    if (!h) throw new Error('unknown ' + ev.data.name);
    var result = await h(ev.data.args || {});
    self.postMessage({ id: id, result: result });
  } catch (err) {
    self.postMessage({ id: id, error: (err && err.message) || String(err) });
  }
});
