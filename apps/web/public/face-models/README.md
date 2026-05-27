# face-api ONNX models

Drop the following files into this directory before launching the kiosk
(`/kiosk` route). They power the local face detection + recognition that
runs inside the Tauri shell.

Download from the upstream repo:
https://github.com/vladmandic/face-api/tree/master/model

Required files:

- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model-shard1`
- `face_recognition_model-shard2`

These files together weigh ~7 MB. They never leave the kiosk machine —
inference runs entirely in the WebView. The server only sees the
resulting 128-dim embedding via `/facial/match` and the marcaciones
queue.

Optional anti-spoofing model (MiniFASNet) is not bundled here; passive
liveness (blink + EAR variance) covers the standard threat model.
