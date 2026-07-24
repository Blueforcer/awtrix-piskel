/**
 * Minimal animated-GIF encoder for pixel art.
 *
 * gif.js always writes a full 256-entry color table and re-encodes every frame
 * through a quantizer, which costs ~1.7 KB per 32x8 frame — far too much for a
 * matrix icon that has to fit one AWTRIX notification body. Icons use a handful
 * of colors, so this encoder builds the global color table from the colors the
 * sprite actually uses (plus one transparent entry when needed) and LZW-encodes
 * the indexed pixels directly. A 7-frame 32x8 sprite drops from ~12 KB to well
 * under 1 KB.
 *
 * Falls back to null when a sprite needs more than 256 distinct colors, so the
 * caller can use gif.js for that (photographic imports); pixel art never does.
 *
 *   pskl.utils.GifEncoder.encode({
 *     width, height,
 *     frames: [canvas, …],      // any canvas/ImageData source, native size
 *     delayMs: 1000 / fps,
 *     repeat: 0                 // 0 = loop forever, -1 = play once
 *   })  ->  Uint8Array | null
 */
(function () {
  var ns = $.namespace("pskl.utils");

  var MAX_COLORS = 256;
  var TRANSPARENT_ALPHA = 128; // below this a pixel is written as transparent

  // ---- bit-level LZW writer (GIF variant: LSB-first, variable code size) ----
  function LzwWriter(minCodeSize) {
    this.bytes = [];
    this.bitBuffer = 0;
    this.bitCount = 0;
    this.codeSize = minCodeSize + 1;
  }

  LzwWriter.prototype.write = function (code) {
    this.bitBuffer |= code << this.bitCount;
    this.bitCount += this.codeSize;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  };

  LzwWriter.prototype.flush = function () {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return this.bytes;
  };

  function lzwEncode(indexes, minCodeSize) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var writer = new LzwWriter(minCodeSize);
    var dict = {};
    var nextCode = eoiCode + 1;

    writer.write(clearCode);

    var prefix = indexes[0];
    for (var i = 1; i < indexes.length; i++) {
      var k = indexes[i];
      var key = prefix + "," + k;
      if (dict[key] !== undefined) {
        prefix = dict[key];
        continue;
      }
      writer.write(prefix);
      dict[key] = nextCode++;
      if (nextCode > 1 << writer.codeSize) {
        if (writer.codeSize < 12) {
          writer.codeSize++;
        } else {
          // Dictionary full: reset, as the decoder expects.
          writer.write(clearCode);
          dict = {};
          nextCode = eoiCode + 1;
          writer.codeSize = minCodeSize + 1;
        }
      }
      prefix = k;
    }
    writer.write(prefix);
    writer.write(eoiCode);
    return writer.flush();
  }

  // ---- byte helpers ---------------------------------------------------------
  function pushShort(out, value) {
    out.push(value & 0xff, (value >> 8) & 0xff);
  }

  function pushString(out, str) {
    for (var i = 0; i < str.length; i++) {
      out.push(str.charCodeAt(i));
    }
  }

  // LZW output travels in sub-blocks of at most 255 bytes, each length-prefixed.
  function pushSubBlocks(out, bytes) {
    for (var i = 0; i < bytes.length; i += 255) {
      var chunk = bytes.slice(i, i + 255);
      out.push(chunk.length);
      for (var j = 0; j < chunk.length; j++) {
        out.push(chunk[j]);
      }
    }
    out.push(0); // block terminator
  }

  function toRgbaData(source, width, height) {
    if (source && source.data) {
      return source.data; // already an ImageData
    }
    return source.getContext("2d").getImageData(0, 0, width, height).data;
  }

  /**
   * Build the shared palette from the colors every frame actually uses.
   * Returns null when the sprite needs more than 256 entries.
   */
  function buildPalette(frameData, hasTransparency) {
    var seen = {};
    var colors = [];
    // Index 0 is reserved for transparency when the sprite has any, so a
    // transparent pixel never has to borrow an opaque color's slot.
    if (hasTransparency) {
      colors.push(0x000000);
    }
    for (var f = 0; f < frameData.length; f++) {
      var d = frameData[f];
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < TRANSPARENT_ALPHA) {
          continue;
        }
        var rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        if (seen[rgb] === undefined) {
          seen[rgb] = colors.length;
          colors.push(rgb);
          if (colors.length > MAX_COLORS) {
            return null;
          }
        }
      }
    }
    // A GIF color table holds a power-of-two number of entries, at least 2.
    var size = 2;
    while (size < colors.length) {
      size *= 2;
    }
    return { colors: colors, lookup: seen, size: size };
  }

  function indexFrame(data, palette, hasTransparency) {
    var indexes = new Array(data.length / 4);
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      if (data[i + 3] < TRANSPARENT_ALPHA) {
        indexes[p] = 0; // reserved transparent slot
      } else {
        indexes[p] =
          palette.lookup[(data[i] << 16) | (data[i + 1] << 8) | data[i + 2]];
      }
    }
    return indexes;
  }

  ns.GifEncoder = {
    /**
     * @return {Uint8Array|null} the GIF bytes, or null if the sprite needs more
     *         than 256 colors (caller should fall back to a quantizing encoder).
     */
    encode: function (options) {
      var width = options.width;
      var height = options.height;
      var sources = options.frames;
      var delayMs = options.delayMs || 100;
      var repeat = options.repeat === undefined ? 0 : options.repeat;

      var frameData = sources.map(function (source) {
        return toRgbaData(source, width, height);
      });

      var hasTransparency = frameData.some(function (d) {
        for (var i = 3; i < d.length; i += 4) {
          if (d[i] < TRANSPARENT_ALPHA) {
            return true;
          }
        }
        return false;
      });

      var palette = buildPalette(frameData, hasTransparency);
      if (palette === null) {
        return null;
      }

      var sizeExp = Math.max(1, Math.round(Math.log(palette.size) / Math.LN2));
      var minCodeSize = Math.max(2, sizeExp);

      var out = [];
      pushString(out, "GIF89a");

      // Logical screen descriptor: global color table, 8-bit color resolution.
      pushShort(out, width);
      pushShort(out, height);
      out.push(0x80 | (0x07 << 4) | (sizeExp - 1));
      out.push(0); // background color index
      out.push(0); // default pixel aspect ratio

      // Global color table, padded to its power-of-two size.
      for (var c = 0; c < 1 << sizeExp; c++) {
        var rgb = c < palette.colors.length ? palette.colors[c] : 0;
        out.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
      }

      // NETSCAPE2.0 application extension: loop count.
      if (repeat >= 0 && frameData.length > 1) {
        out.push(0x21, 0xff, 0x0b);
        pushString(out, "NETSCAPE2.0");
        out.push(0x03, 0x01);
        pushShort(out, repeat); // 0 = forever
        out.push(0x00);
      }

      var delayCs = Math.max(1, Math.round(delayMs / 10)); // GIF delays are 1/100 s

      for (var f = 0; f < frameData.length; f++) {
        // Graphic control extension: disposal + delay + transparency.
        out.push(0x21, 0xf9, 0x04);
        var disposal = hasTransparency ? 2 : 1; // 2 = restore to background
        out.push((disposal << 2) | (hasTransparency ? 1 : 0));
        pushShort(out, delayCs);
        out.push(hasTransparency ? 0 : 0); // transparent color index
        out.push(0x00);

        // Image descriptor: full-frame, no local color table.
        out.push(0x2c);
        pushShort(out, 0);
        pushShort(out, 0);
        pushShort(out, width);
        pushShort(out, height);
        out.push(0x00);

        out.push(minCodeSize);
        pushSubBlocks(
          out,
          lzwEncode(
            indexFrame(frameData[f], palette, hasTransparency),
            minCodeSize
          )
        );
      }

      out.push(0x3b); // trailer
      return new Uint8Array(out);
    },

    /** Convenience: the same bytes as a base64 string (no data: prefix). */
    encodeBase64: function (options) {
      var bytes = ns.GifEncoder.encode(options);
      if (bytes === null) {
        return null;
      }
      var binary = "";
      for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  };
})();
