/**
 * barcode-detector.d.ts
 *
 * Ambient type declarations for the W3C BarcodeDetector API.
 *
 * BarcodeDetector is not yet included in the TypeScript DOM lib (as of TS 5.x).
 * This file provides a project-wide shim so any component can reference
 * `window.BarcodeDetector` without per-file `declare global` augmentations.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
 * @see https://wicg.github.io/shape-detection-api/
 *
 * Browser support (as of 2025):
 *   Supported:  Chrome 83+, Edge 83+, Samsung Internet 13+, Android WebView 83+
 *   Unsupported: Safari (all versions), Firefox (all versions)
 */

interface BarcodeDetectorResult {
  /** The decoded string value of the barcode. */
  rawValue: string;
  /** The format of the detected barcode (e.g. "qr_code", "ean_13"). */
  format: string;
  /** The bounding box of the detected barcode within the source image. */
  boundingBox?: DOMRectReadOnly;
}

interface BarcodeDetectorInstance {
  detect(
    image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap
  ): Promise<BarcodeDetectorResult[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

interface Window {
  /** W3C BarcodeDetector API — undefined in unsupported browsers. */
  BarcodeDetector?: BarcodeDetectorConstructor;
}
