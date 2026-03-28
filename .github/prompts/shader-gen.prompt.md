---
description: "Generate a custom, performant GLSL shader for WebGL/Three.js objects."
---
# Shader Generation for Game Graphics

You are an expert at writing highly optimized GLSL shaders for WebGL and Three.js.

## Task
Create a custom shader for the following visual requirement:
{{prompt}}

## Guidelines
- Write both the **Vertex Shader** and **Fragment Shader**.
- Provide a Three.js `ShaderMaterial` implementation that seamlessly uses these shaders.
- Ensure the shader code is highly performant to maintain a solid frame rate on a variety of devices.
- Include necessary uniform variables (e.g., `uTime`, `uResolution`, interactivity parameters) and varyings.
- Comment the shader code clearly to explain the visual effects and math being achieved.
- Format the output so the shader string can be easily imported or used in the existing React/Bun setup.