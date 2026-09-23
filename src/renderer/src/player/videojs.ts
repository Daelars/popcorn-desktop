// The legacy index.html loaded `video.dev.js` as a plain script, which exposes the library
// as `window.videojs`. The minified build cannot be wrapped as a module (its registration
// helper reads `this`), so the port imports the dev build for its side effect and takes the
// global, exactly like the original page did.
import 'video.js/dist/video-js/video.dev.js'
// The trailer tech registers itself on the global, so it has to load after the library.
import 'videojs-youtube/dist/vjs.youtube.js'

const videojs = window.videojs

export default videojs
