---
title: "Computer Graphics: Curves, Animation, and Rendering"
description: "Spline modeling, skeletal deformation, cloth simulation, ray tracing, and shadow mapping in C++ and OpenGL."
summary: "A collection of graphics assignments exploring how to model shapes, animate them, and turn a scene into an image."
projectPeriod: "December 2025"
projectDate: "2025-12-01"
projectTools: "C++ · OpenGL · GLSL · GLM"
tags: ["Computer Graphics", "C++", "OpenGL", "Simulation"]
cover:
    image: "images/computer-graphics/ray-traced-bunny.png"
    alt: "Ray-traced Stanford bunny with specular highlights and a cast shadow"
    hiddenInSingle: true
draft: false
showToc: true
---

For MIT's 6.4400 Computer Graphics course, I implemented a series of assignments covering spline curves and surfaces, skeletal animation, physically-based simulation, ray tracing, and shadow mapping. Most of the work used GLOO, the course's lightweight C++ OpenGL framework, with GLM for vector and matrix operations.

Here's a small overview of what I learned.

## Modeling Curves and Surfaces

In Assignment 1, I implemented cubic Bézier and B-Spline curves, conversion between their control-point representations, and bicubic tensor product patches. This gave me a better understanding of non-polygonal representations for surfaces. Since the patches are continuous and differentiable, we can easily get the normal for lighting as well.

## Attaching a Mesh to a Skeleton

Assignment 2 covered hierarchical transforms and skeletal subspace deformation, also called linear blend skinning. I built a node hierarchy and attached a mesh using per-vertex joint weights. Rotating a parent joint carries its descendants with it, while the weights let a vertex respond to several joints at once.

The approach is to first move a vertex from the character's bind pose into a joint's bind-pose coordinate frame, then move it back using that joint's current transform. I also passed accumulated transforms down the scene tree when collecting objects for rendering, avoiding repeated walks up the hierarchy. I believe this is very similar (if not identical) to how videogames handle object rendering trees.

{{< details title="Code: one joint's contribution to a vertex" >}}

```cpp
glm::mat4x4 &bind_pose_joint_to_character_inverse_ = Bs_[j];
glm::mat4x4 &joint_to_character = joint_to_character_matrices[j];
glm::vec4 position_contribution = (attachment_weights_[i][j] *
joint_to_character * bind_pose_joint_to_character_inverse_ * bind_pose_position);

new_positions->at(i) += glm::vec3(position_contribution);
```

Summing these weighted contributions gives the deformed vertex position.

{{< /details >}}

## Simulating Motion with Particles and Springs

For Assignment 3, I implemented forward Euler, explicit trapezoidal, and fourth-order Runge–Kutta integration, then used them for circular motion, a spring-connected pendulum, and wireframe cloth. The particle system combines gravity, drag, and spring forces. The integrator then advances its positions and velocities over time.

The cloth is a grid with structural springs connecting neighbors, shear springs connecting diagonals, and flex springs spanning two grid edges. These resist stretching, diagonal collapse, and bending. This was more of a programming exercise, but it was still cool to see how to make a cloth simulation.

## Rendering with Rays

We were tasked with building a CPU ray tracer. I implemented sphere, plane, and triangle intersections, Phong lighting, shadow rays, and recursive reflections. Rays are transformed into object space for intersection, while normals return to world space using the inverse transpose of the object's transform.

{{< details title="Code: tracing a reflection" >}}

```cpp
if(bounces > 0) {
  // ray bounces
  const glm::vec3 ray_bounce_origin    = hit_position + EPSILON * eye_reflection;
  const glm::vec3 ray_bounce_direction = eye_reflection;
  const Ray       ray_bounce(ray_bounce_origin, ray_bounce_direction);
  HitRecord bounce_record = HitRecord();
  color += material_specular_color * TraceRay(ray_bounce, bounces - 1, bounce_record);
}
```

`eye_reflection` is the reflected viewing-ray direction. The small offset keeps the new ray from immediately intersecting the surface it just left.

{{< /details >}}

## Casting Shadows in OpenGL

Assignment 5 involved texture mapping and shadows from a directional light. I rendered the scene from the light's viewpoint into a depth texture, then sampled that texture while shading the camera's view. If a fragment is farther from the light than the stored depth, another surface is blocking it.

This involved framebuffer objects, texture sampling, coordinate transforms, and GLSL. A small depth bias helps prevent a surface from incorrectly shadowing itself because of numerical error.

{{< details title="Code: comparing against the shadow map" >}}

```glsl
vec3 proj_coords = (world_to_light_ndc_matrix * vec4(world_position, 1.0)).xyz;
proj_coords = proj_coords * 0.5 + 0.5;
float this_depth     = proj_coords.z;
float occluder_depth = texture(shadow_texture, proj_coords.xy).r;

float bias = 0.005;
if(occluder_depth < this_depth - bias) {
    return vec3(0.0, 0.0, 0.0);
}
```
{{< /details >}}

These assignments preceded my final project, [emulating Ghost of Tsushima's procedural grass in Godot](/posts/grass/).
