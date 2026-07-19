// gl-stub.js — stands in for romdev-core-host's OPTIONAL native GL deps
// (native-gles / webgl-node).
//
// core-host reaches those only through a lazy `await import()` in
// glOptionalDep.js, on the hardware-render path used by the 3D cores. This app
// runs the GameTank core, a software core, so the path is unreachable — but bundlers still
// follow the specifier, and native-gles is a .node binary they cannot load.
// Aliasing both to this module keeps them out of the graph; if the HW path ever
// did run, the throw below would say exactly why rather than fail obscurely.

const unavailable = () => {
  throw new Error("native GL is not available in the browser build (software cores only)");
};

export default { createContext: unavailable };
