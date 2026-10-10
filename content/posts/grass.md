---
title: "Emulating Ghost of Tsushima's Grass in Godot"
date: 2026-02-28
description: "Procedural grass generation, noise-driven wind and clumping, and custom lighting in Godot."
tags: ["Computer Graphics", "Godot", "Shaders"]
cover:
    image: "images/grass/result.png"
    alt: "A procedurally generated grass field on rolling terrain in Godot"
    hiddenInSingle: true
    caption: "Result at a density of 0.4. Uses a terrain heightmap for demonstrative purposes."
showToc: true
---

For this project, I tried to recreate the feel of Ghost of Tsushima's procedural grass in Godot, following their 2021 Advanced Graphics Summit talk, *Procedural Grass in 'Ghost of Tsushima'*. This was my final project for MIT's 6.4400 Computer Graphics course.

{{< youtube MAErwFxp7_Y >}}

Here's a twenty-one second demo of an open field at a density of 0.4 (more on what that means later). For this scene, I used a terrain heightmap generated from simplex noise.

## Introduction

The 2021 Advanced Graphics Summit talk *Procedural Grass in 'Ghost of Tsushima'* presents an efficient and beautiful implementation of procedural grass that supports the game's artistic vision while running within the PS4's performance budget.

My goal was to preserve the feel and appearance of the game's procedural grass without the more sophisticated artist authored assets and wind system. Instead, I use a scrolling Perlin noise texture for wind strength and orientation samples, a cellular noise texture to simulate clumping of nearby blade meshes, rounding of normals in the vertex shader, and albedo interpolation based on the height of the fragment with respect to the blade mesh. To tie it all together, a custom lighting pass simulates ambient bounces and occlusion, as well as blending of blade colors in the distance.

The approach comes down to three main tricks:

- Use GPU Instancing to draw chunks of grass blades together, avoiding millions of separate draw calls.
- Use moving noise patterns for wind and clusters of similar values to simulate grass clumping.
- Use color and lighting to make flat blade meshes look rounded and give the field depth with ambient occlusion.

{{< details title="How Ghost of Tsushima's system works" >}}

The game world is tiled, with each tile containing an instance of multiple grass blade meshes via GPU instancing, using a single draw call to instantiate all instances of the blade mesh within the tile. Every blade of grass bends with respect to an artist authored bezier curve and has a unique random offset to its position, orientation, scale, and bend. Then, the wind strength and direction at the blade's position is sampled from the game's wind system to modify the blade's bend and orientation. They also implemented a "clumping" system where nearby grass blades belonging to the same "clump" obtain similar random properties for all of the above parameters. Each grass blade "type" is artist authored and includes separate vein and stem albedo, gloss, and normal textures which round the edges of the grass blade to give it a more realistic appearance. For performance, the blade meshes are assigned one of two LOD models and are view frustum culled.

{{< /details >}}
{{< details title="Godot setup" >}}

I built this in Godot 4.5, using its graphics pipeline and FastNoiseLite library. The setup is pretty simple: a light source and camera attached to the root node, a script, and a material asset for the grass shader.

{{< /details >}}

## Drawing Millions of Blades

The world map is divided into tiles of a specified tile size. Using a density parameter \(d \in (0,1]\), we can prepare \(\mathrm{row}^2\) evenly spaced grass blade meshes in a grid formation, where \( \mathrm{row} = \mathrm{size}_t \times 10d \). Here, \(\mathrm{size}_t\) is the side length of a square tile and \(\mathrm{row}\) is the number of blades along each side. This gives us an easy way to modify how many grass blades we want in each tile by shifting \(d\).
Each tile is instantiated using Godot's MultiMesh class, which draws all its grass blade meshes together. This matters a lot for performance, as we'd otherwise need a separate draw call for each of the millions of grass blades.

{{< details title="What are meshes, GPU instancing, and draw calls?" >}}

A mesh is the shape of a 3D object, built from points (vertices) connected into triangles. Here, it's a single blade of grass. A draw call is a command telling the graphics processor to draw something. GPU instancing uses one single draw call to draw the same shape many times with different positions, sizes, and rotations.

{{< /details >}}
{{< figure src="/images/grass/mesh-uv.png" alt="Grass blade mesh and its UV map in Blender" caption="One simple blade is repeated across the field. On the right, the UV map tells the shader where a point sits on the blade." >}}

The simple UV map lets us use the \(uv\) coordinates as the relative width and height of the grass blade in the shaders later on.

## Making the Grass Move and Clump

Using a perlin noise texture and a wind speed, we can create the illusion of unique grass blades which appear to flow and bend with the wind. We can use another noise texture to simulate grass clumping, a natural phenomenon where nearby blades of grass will exhibit similar properties. Without it, we'd get grass of random heights all over the place which looks unnatural. I implement both of these things using a vertex and a fragment shader.

{{< details title="What are vertex and fragment shaders?" >}}

A shader is a small program that runs on the graphics processor. A vertex shader moves the points that make up each blade, so it handles bending and rotation. A fragment shader decides what color the blade's surface should be at each visible point.

{{< /details >}}

{{< details title="What is a noise texture?" >}}

A noise texture is a texture with randomized values. Each kind of noise texture has useful properties which vary depending on the generation technique. Making every pixel a random (0, 1] value is often referred to as static or white noise, for example.

{{< /details >}}

### Bending in the Wind
To emulate wind we can "scroll" a wind texture across the field of grass. We effectively map the texture to the entire grid by always sampling relative to each blade's position in the shader. To achieve scrolling, we add a time offset to the sampling position. This essentially sweeps the same wind strength values across a direction, achieving the illusion of a continuous gust of wind.

I use Perlin noise for the scrolling wind texture because its values change smoothly: nearby values are similar. This means neighboring blades get similar wind strength and direction, so the grass moves together instead of each blade jittering as we scroll the wind texture. Feel free to experiment with other kinds of noise. I generated the texture with Godot's FastNoiseLite library. I enabled domain warping for a more interesting wind pattern and made the texture seamless to avoid strange patterns when scrolling across the edges.

I sample the Perlin noise texture at the same position for the wind's target orientation and rotation strength, then at another position for bending. The bending sample scrolls faster and uses a height-based time offset, so points farther along the blade sample a bit ahead in time, emulating turbulence.

{{< grass-demo kind="wind" title="3D wind scrolling demonstration" caption="A simplified tile of grass sampling a seamless Perlin wind texture. Use the slider to scroll the texture and watch the blades respond." >}}

{{< details title="Technical details: wind, rotation, and bending" >}}

I implement all of this in the vertex shader.

I sample the Perlin noise texture (or "wind texture") at coordinates \(s_0\), using elapsed time \(t\) in seconds, wind speed \(w_s\) (default `1.0`), and the blade's ground-plane position \(\mathrm{pos}_{\mathrm{world}}\) (world-space x and z). The constant \(c_d\) scales the sampling coordinates:

\[
s_0 = c_d\left(w_s(t,t)+\frac{\mathrm{pos}_{\mathrm{world}}}{w_s}\right)
\]

I multiply the sampled value by \(\pi/2\) to get the wind angle \(w_\theta\). Increasing \(w_s\) makes the wind texture scroll faster. I used \(0.005\) for \(c_d\).
I compute the blade's initial rotation angle \(\theta_0\) using its repeatable position-based hash \(x_p\) and the sampled clump value \(x_c\), both in \([0,1]\). Here, \(\tau=2\pi\) is a full turn in radians:
\[
\theta_0 = \left(\frac{1}{3}x_c+\operatorname{mix}(-0.15,0.15,x_p)\right)\tau
\]
I also sample a wind strength \(w_f\) from the wind texture at \(s_0\) and multiply it by a factor of \(4/5\). I blend these into the final rotation angle \(\theta\), using \(\operatorname{mix}(a,b,u)=(1-u)a+ub\):
\[
\theta = \operatorname{mix}(\theta_0,w_\theta,w_f)
\]
This angle is used to generate a rotation matrix about the y-axis \(M_r\).

I use the relative height of the vertex \(h=1-\mathrm{UV}_y\), from `0` at the base to `1` at the tip, to compute an initial bend angle \(\beta_0\). The variation value \(x=(1-c)x_p+cx_c\) combines the blade hash and clump value with clumping weight \(c=0.8\):
\[
\beta_0 = h\pi\,\operatorname{mix}(0.10,0.2x,h)
\]
I then sample the wind texture at a second set of coordinates \(s_1\). Here, \(t_h=t+0.25h^2\) offsets the time farther along the blade. The temporal sampling factor is `0.05`, while the spatial factor remains \(c_d=0.005\):
\[
s_1 = 0.05(t_h,t_h)+c_d\frac{\mathrm{pos}_{\mathrm{world}}}{w_s}
\]
I call the value sampled here \(w_b\). I remap it from \([0,1]\) to \([0.25,1]\) and square it, then multiply by wind speed and a bend variation factor \(q\). That factor blends a fixed value with the blade's hash using the clump value:
\[
q = \operatorname{mix}(0.1,0.1+0.4x_p,x_c)
\]
The remapped strength produces the final bend angle \(\beta\):
\[
\beta = \beta_0+\pi\,w_s\,q\left[\operatorname{mix}(0.25,1.0,w_b)\right]^2
\]
This matches the shader's `mix(0, PI, wind_strength_bend)`, since blending from zero to \(\pi\) is just multiplication by \(\pi\). The angle generates a rotation matrix about the x-axis, \(M_b\). The height-dependent offset puts the blade tips ahead in the wind texture; the additional wind bend itself has no extra \(h^2\) multiplier.

Finally, I apply both rotation matrices to the vertex position \(\boldsymbol{v}\) and the normal:
\[
\boldsymbol{v} \gets M_rM_b\boldsymbol{v}
\]
to properly rotate and bend the blade mesh.

Unless otherwise mentioned, I picked the constants by experimenting and seeing what looked good.

{{< /details >}}

{{< figure src="/images/grass/perlin-noise.png" alt="Grayscale Perlin noise texture used to drive wind" caption="Scrolling this pattern makes neighboring blades move together. Settings are in wind_noise.tres." >}}

### Giving Each Blade Some Variation

Individual blades are different from each other, but remain similar to nearby blades. I combine a value unique to each blade with a value from the clump texture, then use the result for width and height variation. By using a mix of the unique and clump values, we get groups of blades with similar heights and orientations (clump factor) that are still slightly different from each other.

I use cellular noise for the grass clump texture. Nearby values cluster together, with visible boundaries between groups of similar values. I generated this texture with FastNoiseLite too, using the default settings.

{{< figure src="/images/grass/cellular-noise.png" alt="Grayscale cellular noise texture with clusters of similar values" caption="Clusters of similar gray values give neighboring blades similar sizes and shapes, creating clumps." >}}

{{< grass-demo kind="clumping" title="3D comparison of random and clumped grass sizes" caption="The left tile uses independent per-blade variation. The right blends those same values with a cellular texture, creating patches of similar blade sizes. Adjust the clumping weight to compare." >}}

{{< details title="Technical details: blade appearance variation" >}}

I use the blade's world position to generate a hash value \(x_p\) in \([0,1]\) and sample the cellular noise texture (or "clump texture") to get a value \(x_c\) in \([0,1]\). I combine these into a variation parameter \(x\), using the clumping weight \(c\) (set to `0.8`). At \(c=0\), each blade uses only its own random value; at \(c=1\), it uses only the clump texture:
\[
x = (1-c)x_p + cx_c
\]
that I use to scale the blade mesh's vertex. I scale the vertex's local horizontal coordinate \(v_x\) and vertical coordinate \(v_y\) with the following expressions. The function \(\operatorname{mix}(a,b,u)=(1-u)a+ub\) blends between two values:
\[
\begin{aligned}v_x &= \operatorname{mix}(0.2,0.5,x)\,v_x \\ v_y &= \operatorname{mix}(0.5,2.0,x)\,v_y\end{aligned}
\]
for width and height variation.

{{< /details >}}

## Making Flat Blades Look Rounded

The grass blades are simple, flat meshes. We can artificially round them without adding extra geometry by adjusting the angle of normals close to the edge of the blade. By pointing these further outwards we get the illusion of curvature on the flat mesh.

{{< grass-demo kind="normals" title="3D comparison of flat and rounded normals" caption="Identical flat blade meshes, with flat normals on the left and rounded normals on the right. Adjust the curvature to see how lighting changes without adding geometry." >}}
{{< details title="What is a normal?" >}}

The normal vector at a point on a mesh is the vector perpendicular to the surface. Lighting uses it to work out how the surface faces the light. By varying that direction across a flat blade, we can make the lighting behave as if the blade were curved.

{{< /details >}}
{{< details title="Technical details: rounded normals" >}}

In the vertex shader I compute leftward and rightward facing normals by rotating the normal about the y-axis by \(c_n\pi\) and \(-c_n\pi\), respectively. The curvature parameter \(c_n\) corresponds to `normal_curve_factor` in the shader, with a default of `0.3` and a range of `0` to `0.5`; multiplying by \(\pi\) gives an angle in radians. I pass these to the fragment shader and interpolate between them using the fragment's horizontal coordinate \(\mathrm{UV}_x\), which runs across the blade. This makes the flat blades look rounded.

{{< /details >}}
## Coloring the Grass

I interpolate between a base color and a tip color to color every blade of grass. I also color distant fragments closer to the average color to simulate blending at far distances.

{{< figure src="/images/grass/base-tip-color.png" alt="Grass blade colors blended from base to tip" caption="Each blade transitions from its base color to its tip color." >}}
{{< comparison before="/images/grass/distance-blending-before.png" after="/images/grass/distance-blending-after.png" beforeLabel="Without distance blending" afterLabel="With distance blending" caption="Left: individual colors stay distinct in the distance. Right: blending them makes the distant field look smoother." >}}

{{< details title="Technical details: fragment shader and color blending" >}}

The fragment shader uses the specified base color \(\boldsymbol{b}\) and tip color \(\boldsymbol{b}^{\prime}\) to color every blade of grass. I also color distant fragments closer to the average color to simulate blending at far distances.

I set the albedo using relative height \(h=1-\mathrm{UV}_y\), from base (`0`) to tip (`1`). The function \(\operatorname{mix}(a,b,u)=(1-u)a+ub\) blends between colors:
\[
\operatorname{mix}\left(\frac{\boldsymbol{b}+\boldsymbol{b}^{\prime}}{4},\operatorname{mix}(\boldsymbol{b},\boldsymbol{b}^{\prime},h^2),e^{-0.04\lVert\boldsymbol{v}\rVert}\right)
\]
Here, \(\boldsymbol{v}\) is the fragment position in view space, so \(\lVert\boldsymbol{v}\rVert\) is its distance from the camera. The constant `0.04` controls how quickly the distant color takes over, and \(e\) is the base of the natural exponential. The divisor `4` is the shader's chosen distant-color factor, rather than a literal average of the two colors.

{{< /details >}}
## Giving the Field Depth

To tie it all together, a custom lighting pass simulates ambient bounces and occlusion. I darken the base of the grass based on the field's density, which gives the field more depth.

{{< grass-demo kind="occlusion" title="3D comparison of grass ambient occlusion" caption="The same tile without ambient occlusion on the left and with density-based base darkening on the right. Move the slider to see how occlusion adds depth." >}}
{{< details title="What is ambient occlusion?" >}}

Ambient occlusion approximates how nearby surfaces block light from reaching each other. The bases of densely packed grass get less light than the exposed tips. Here, I approximate that with the grass density and the height along the blade in the lighting function (`light()`).

{{< /details >}}
{{< details title="Technical details: lighting pass" >}}

I emulate ambient occlusion using grass density \(d\) and relative height \(h=1-\mathrm{UV}_y\), from base to tip. The occlusion factor \(o\) darkens the base more as density increases. Using \(\operatorname{mix}(a,b,u)=(1-u)a+ub\), I set it as
\[
o = \operatorname{mix}\left(1-\frac{3}{4}d,1,h^2\right)
\]
I then set the diffuse lighting color to
\[
\boldsymbol{\alpha}\,o\,\boldsymbol{l}_c\,2^{\boldsymbol{n}\cdot\boldsymbol{l}-2}
\]
Here, \(\boldsymbol{\alpha}\) is Godot's light attenuation (`ATTENUATION`), \(\boldsymbol{l}_c\) is the light color (`LIGHT_COLOR`), \(\boldsymbol{n}\) is the surface normal (`NORMAL`), and \(\boldsymbol{l}\) is the direction toward the light (`LIGHT`). The dot product \(\boldsymbol{n}\cdot\boldsymbol{l}\) measures how directly the surface faces the light. This gives a result I'm happy with.

{{< /details >}}
## Results

{{< grass-demo kind="result" title="Animated 3D grass field combining all four techniques" caption="A simplified live WebGL scene combining scrolling wind, clumped blade sizes, rounded normals, and density-based ambient occlusion. The video at the top shows the full Godot implementation." >}}

The full Godot implementation shown in the video runs at 60-230 FPS on my test computer, depending on the density. This measurement is for the Godot scene, rather than the simplified browser demo. Individual blades are different from each other but remain similar to nearby blades, and the scrolling Perlin noise texture does a pretty good job of emulating wind.

{{< figure src="/images/grass/result.png" alt="Final grass field over rolling terrain in Godot" caption="The finished field at a density of 0.4, using a terrain heightmap for the demonstration." >}}
The ground mesh uses an albedo based on the base and tip color, specified density, and distance from the camera.

## Conclusion
I'm happy with how closely this captures the feel of Ghost of Tsushima's grass. There's still more I'd like to try, including the game's specular lighting and shadows, and its bezier curve approach to bending individual blades.

You might notice that blades being viewed from their side look thin and not that great. The original Tsushima implementation rotates blades close to the camera to hide this problem. I'd like to work on this next if I do put it in a game.

For that, I'd also need to add performance optimizations like view frustum culling and LOD switching ([this person implemented it](https://github.com/2Retr0/GodotGrass)).

{{< details title="What are view frustum culling and LOD switching?" >}}

View frustum culling skips objects outside the camera's view. LOD (level of detail) switching uses simpler versions of objects farther away, where the extra detail is harder to see.

{{< /details >}}

## Source Code and References
[Source code for the project](https://github.com/rekomodo/6440_final).

1. [Procedural Grass in 'Ghost of Tsushima'](https://www.youtube.com/watch?v=Ibe1JBF5i5Y)
2. [Texture Generation using Random Noise](https://lodev.org/cgtutor/randomnoise.html)
3. [Similar implementation of this emulation](https://github.com/2Retr0/GodotGrass)
4. [How do Major Video Games Render Grass?](https://www.youtube.com/watch?v=bp7REZBV4P4)
5. [Modern Foliage Rendering](https://www.youtube.com/watch?v=jw00MbIJcrk)
## Acknowledgment
A lot of the implementation details came from [2Retr0's approach](https://github.com/2Retr0/GodotGrass) to the same idea. This is mostly a simplified version with reduced scope. Their version is also much better looking.

I'd like to thank the maintainers and contributors of the Godot game engine for providing an excellent platform on which to experiment with computer graphics.

I'd also like to thank the maintainers and contributors of the Blender 3D software for providing an excellent platform on which to create models and specify UV mappings.