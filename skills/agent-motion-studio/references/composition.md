# Object composition through the agent

For product actions and changing document states, use the general v2 `composition` scene. Do not change renderer for ordinary film edits. Read the distributed [format guide](../../../docs/COMPOSITION.md). No automatic decor or animation is added.

Objects are a flat ordered array of text, rect/ellipse shapes and immutable imported images. Required: id/type/x/y/width/height, plus text/shape/asset for that type. Coordinates are fixed output pixels; width/height positive; opacity/reveal 0–1; rotation degrees around centre. Text defaults to 48px, weight 700; explicit line breaks and wrapping, overflow is an error. Paint is hex or brand background/foreground/accent. Images use contain/cover and focalPoint. Only bundled Latin/Cyrillic text.

Use 1080×1920 or 1920×1080 to design the actual layout. Each object has independent keyframes, strictly increasing local frame integers (0–1800), up to 64. Animate x/y/width/height/opacity/rotation/reveal. Each property interpolates only its own keys; base is frame zero and last value holds. Destination easing: linear/outCubic/inOutCubic/step. Set a hold key before a delayed action; otherwise interpolation starts at frame zero. Shortening clips later keys but preserves them. Text reveal maintains final wrapping. Layer order is array order, no groups or expressions.

Before assembly save a storyboard and three key frames; show a product action in each main shot. Vary shot scale/action/layout, avoid repeated decorative entrances. Budget reading holds and cuts against music. Use aligned separate text objects for code/table columns. Never invent product metrics or real demand. Local synthetic examples must be labelled fictional.

Read current state. Copy the scene's complete objects array into `edit-scene.patch.objects`; change only the selected object by ID. Reuse all other objects/fields. Preview the exact action with current ETag, inspect settled/moving/cut frames, check stale:false and unchanged accepted bytes/history; accept with preview.projectHash. Do not guess an ETag or blindly retry. A duration-only edit needs only patch.durationFrames. Keep baseline revision for restore-scene or full restore. Image references use returned importedId, never direct paths/URLs. Sources and history stay in the project.

```json
{"type":"edit-scene","sceneId":"result","patch":{"durationFrames":75}}
```

Report layout inspection, continuous playback and audio listening separately from decode/tests. Deliver MP4, complete editable folder/ZIP, local source credits, action JSON, original/changed/restored results. Browser can preview/export/shorten/restore, but object authoring currently uses API/CLI. No realtime timeline, arbitrary code, video layers, groups/masks, shape paths or keyframed font/color. Old binaries cannot read this new scene type.
