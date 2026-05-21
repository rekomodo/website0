---
title: "Emulating Ghost of Tsushima's Grass in Godot"
date: 2026-02-28
description: "Pretty grass using some shaders and GPU instancing."
tags: ["Computer Graphics", "Godot", "Shaders"]
cover:
    image: "images/grass-hero.png"
    alt: "generated grassy hills"
    caption: "procedural grass field"
showToc: true
---

This project is an emulation of the procedural grass system used in Ghost of Tsushima,
as originally described in their 2021 Advanced Graphics Summit talk. My goal was to implement
the most essential parts of the approach to approximate the feel of Tsushima's grass without 
some of the more technical implementation details. This was also used as my final project 
for MIT's Computer Graphics course!

# Approach

## Procedural Generation of Grass Tiles

To handle millions of grass blades without tanking the frame rate,
I used [Godot’s MultiMeshes](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html#multimeshes).
This allows the engine to render an entire tile of grass using only a single draw call.
The world is divided into tiles, and grass density on every tile is controlled by a `density` parameter. 

<!-- TODO: section for technical details and code -->

## Noise-Driven Motion

Tsushima's developers made use of various techniques involving noise textures to emulate grass patch variation and clumping.

* Perlin Noise: Used for a scrolling wind texture to create smooth, continuous motion across the field.

* Cellular Noise: Used to simulate "clumping". This clusters nearby blades together so they share similar properties, mimicking how grass grows in the wild.

## Shaders
### Vertex Shader

The motion of the grass is handled almost entirely in the vertex shader to keep it efficient.

* Wind and Bend: Each blade samples the scrolling wind texture to determine its rotation and bend angle. I added a height-based factor to the sampling so the tips of the blades appear to lead the movement, which emulates wind turbulence.

* Blade Variation: I used a hash value based on each blade's unique world position to randomize its width and height.

* Rounded Normals: To make the flat meshes look more 3D, I computed leftward and rightward facing normals. These are interpolated in the fragment shader to give the blades a rounded appearance.

### Fragment Shader and Lighting

The fragment shader handles the final look and color blending.

* Color Blending: I used base and tip color variables to gradient each blade.

* Distance Blending: To avoid visual noise in the distance, distant fragments are blended toward an average color.

* Ambient Occlusion: I simulated ambient occlusion by darkening the base of the grass based on the field's density, which adds depth to the scene.

## Results

{{< youtube MAErwFxp7_Y >}}

## Project Links

[Source Code]()
