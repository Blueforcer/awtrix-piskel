/** Remove the no-op virtual entry emitted by Vite. */

function cssReplace() {
  return {
    name: "piskel-css-replace",
    enforce: "post",

    generateBundle(_options, bundle) {
      if (bundle["_entry.js"]) {
        delete bundle["_entry.js"];
      }
    }
  };
}

module.exports = cssReplace;
