---
title: "Emulating Ghost of Tsushima's Grass in Godot"
date: 2026-02-28
description: "Procedural grass generation, noise-driven wind and clumping, and custom lighting in Godot."
tags: ["Computer Graphics", "Godot", "Shaders"]
cover:
    image: "images/grass/result.png"
    alt: "A procedurally generated grass field on rolling terrain in Godot"
    caption: "Result at a density of 0.4. Uses a terrain heightmap for demonstrative purposes."
showToc: true
---
For this project, I tried to recreate the feel of Ghost of Tsushima's procedural grass in Godot, following their 2021 Advanced Graphics Summit talk, *Procedural Grass in 'Ghost of Tsushima'*. This was my final project for MIT's 6.4400 Computer Graphics course.

## Introduction
The 2021 Advanced Graphics Summit talk *Procedural Grass in 'Ghost of Tsushima'* presents an efficient and beautiful implementation of procedural grass that supports the game's artistic vision while running within the PS4's performance budget. 

To achieve this, the game world is tiled, with each tile containing an instance of multiple grass blade meshes via GPU instancing, using a single draw call to instantiate all instances of the blade mesh within the tile. Every blade of grass bends with respect to an artist authored bezier curve and has a unique random offset to its position, orientation, scale, and bend. Then, the wind strength and direction at the blade's position is sampled from the game's wind system to modify the blade's bend and orientation. They also implemented a "clumping" system where nearby grass blades belonging to the same "clump" obtain similar random properties for all of the above parameters. Each grass blade "type" is artist authored and includes separate vein and stem albedo, gloss, and normal textures which round the edges of the grass blade to give it a more realistic appearance. For performance, the blade meshes are assigned one of two LOD models and are view frustum culled.

My goal was to preserve the feel and appearance of the game's procedural grass without the more sophisticated artist authored assets and wind system. Instead, I use a scrolling Perlin noise texture for wind strength and orientation samples, a cellular noise texture to simulate clumping of nearby blade meshes, rounding of normals in the vertex shader, and albedo interpolation based on the height of the fragment with respect to the blade mesh. To tie it all together, a custom lighting pass simulates ambient bounces and occlusion, as well as blending of blade colors in the distance.
## Approach
### Godot Game Engine
I built this in Godot 4.5, using its graphics pipeline and FastNoiseLite library. The setup is pretty simple: a light source and camera attached to the root node, a script, and a material asset for the grass shader.
### Procedural Generation and Instancing
The world map is divided into tiles of a specified tile size \(\mathrm{size}_t\). Using a density parameter \(d \in (0,1]\), we can prepare \(\mathrm{row}^2\) evenly spaced grass blade meshes in a grid formation, where
\[
\mathrm{row} = \mathrm{size}_t \times 10d
\]
Each tile is instantiated using the Godot game engine's MultiMesh class which instances all grass blade meshes in the prepared MultiMesh using one draw call, which is a technique known as GPU instancing. This matters a lot for performance: otherwise, I'd need a separate draw call for each of the millions of grass blades. Each grass blade mesh is a 15 vertex object with a simple UV mapping which lets us get the fragment's relative height in the fragment shader.

{{< figure src="/images/grass/mesh-uv.png" alt="Grass blade mesh and its UV map in Blender" caption="Mesh and UV map, made with Blender." >}}
### Noise-Driven Motion and Clumping
I use Perlin noise for the scrolling wind texture because its values are smooth, continuous, and seamless. I generated the texture with Godot's FastNoiseLite library. I enabled domain warping for a more interesting wind pattern and made the texture seamless to avoid strange patterns when scrolling across its edges.

{{< figure src="/images/grass/perlin-noise.png" alt="Grayscale Perlin noise texture used to drive wind" caption="Perlin noise used for the scrolling wind texture. Parameters for generation available in the project source in the file wind_noise.tres." >}}

I use cellular noise to emulate grass clumping. Nearby values cluster together, with visible boundaries between groups of similar values. I generated this texture with FastNoiseLite too, using the default settings.

{{< figure src="/images/grass/cellular-noise.png" alt="Grayscale cellular noise texture with clusters of similar values" caption="Cellular noise used for grass blade clumping." >}}
### Vertex Shader
With these noise textures and a wind speed \(w_s\) I generate unique grass blades which form clumps with other nearby blades and appear to flow and bend with the wind. Unless I mention otherwise, I picked the constants below by experimenting and seeing what looked good.
#### Blade Appearance Variation
I use the blade's world position to generate a hash value \(x_p\) in \([0,1]\) and sample the cellular noise texture (or "clump texture") to get a value \(x_c\) in \([0,1]\). I combine these into a variation parameter
\[
x = (1-c)x_p + cx_c
\]
that I use to scale the blade mesh's vertex. I scale the vertex with
\[
\begin{aligned}v_x &= \operatorname{mix}(0.2,0.5,x)\,v_x \\ v_y &= \operatorname{mix}(0.5,2.0,x)\,v_y\end{aligned}
\]
for width and height variation.
#### Wind
I sample the Perlin noise texture (or "wind texture"), at

\[
s_0 = c_d\left(w_s(t,t)+\frac{\mathrm{pos}_{\mathrm{world}}}{w_s}\right)
\]

and multiply the value by \(\pi/2\) to get the wind angle \(w_\theta\). Increasing \(w_s\) makes the wind texture scroll faster. I used \(0.005\) for \(c_d\).
I compute the blade's unique rotation angle as
\[
\theta_0 = \left(\frac{1}{3}c_h+\operatorname{mix}(-0.15,0.15,x_p)\right)\tau
\]
and sample a wind strength \(w_f\) from the wind texture at \(s_0\) and multiply it by a factor of \(4/5\). The final rotation angle computed as
\[
\theta = \operatorname{mix}(\theta_0,w_\theta,w_f)
\]
is used to generate a rotation matrix about the y-axis \(M_r\).

I use the relative height of the vertex \(h=\mathrm{UV}_y\) to compute an initial bend angle
\[
\beta_0 = h\pi\,\operatorname{mix}\left(\frac{1}{10},\frac{2}{5},x\right)
\]
and sample the wind texture at
\[
s_1 = c_d^{2/3}w_s(t_h,t_h)+c_dh^2+c_d\frac{\mathrm{pos}_{\mathrm{world}}}{w_s}
\]
to get the wind strength for the bend \(w_b\). The final bend angle computed as
\[
\begin{aligned}\beta &= \beta_0+\operatorname{mix}\left(0,\pi,w_sw_bh^2q\right) \\ q &= \operatorname{mix}\left(\frac{1}{10},\frac{1}{10}+\frac{2}{5}x_p,x_c\right)\end{aligned}
\]
Here, \(q\) is the bend variation factor. The final bend angle is used to generate a rotation matrix about the x-axis \(M_b\). The extra \(h\)-based factor puts the blade tips a bit ahead in the wind texture, emulating turbulence. Then, I mix up to a constant based on the vertex height so that the blade bends more towards the tip.

Finally, I update the vertex and normal as
\[
\boldsymbol{v} \gets M_rM_b\boldsymbol{v}
\]
to properly rotate and bend the blade mesh.
#### Rounded Normals
In the vertex shader I compute leftward and rightward facing normals by rotating the normal about the y-axis by \(c_n\pi\) and \(-c_n\pi\), respectively. I pass these to the fragment shader and interpolate between them using the fragment's horizontal UV coordinate. This makes the flat blades look rounded.

{{< figure src="/images/grass/rounded-normals.png" alt="Comparison of flat grass blade normals on the left and rounded normals on the right" caption="Left: No rounded normals. Right: Rounded normals." >}}
### Fragment Shader
The fragment shader uses the specified base color \(\boldsymbol{b}\) and tip color \(\boldsymbol{b}^{\prime}\) to color every blade of grass. I also color distant fragments closer to the average color to simulate blending at far distances.

I set the albedo as
\[
\operatorname{mix}\left(\frac{\boldsymbol{b}+\boldsymbol{b}^{\prime}}{4},\operatorname{mix}(\boldsymbol{b},\boldsymbol{b}^{\prime},h^2),e^{-0.04\lVert\boldsymbol{v}\rVert}\right)
\]
where \(\boldsymbol{v}\) is the fragment position in view space.

{{< figure src="/images/grass/base-tip-color.png" alt="Close-up of grass blades showing a color gradient from base to tip" caption="Base to tip color blending." >}}

{{< figure src="/images/grass/distance-blending.png" alt="Comparison of distant grass without color blending on the left and with blending on the right" caption="Left: No distance-based blending. Right: With distance-based blending." >}}
### Lighting Pass
I emulate ambient occlusion using the density \(d\) by setting the occlusion factor \(o\) as
\[
o = \operatorname{mix}\left(1-\frac{3}{4}d,1,h^2\right)
\]
and setting the diffuse lighting color to
\[
\boldsymbol{\alpha}\,o\,\boldsymbol{l}_c\,2^{\boldsymbol{n}\cdot\boldsymbol{l}-2}
\]
which gives a result I'm happy with.

{{< figure src="/images/grass/ambient-occlusion.png" alt="Comparison of grass before ambient occlusion on the left and with darkened bases on the right" caption="Left: Before ambient occlusion. Right: Effect of simulated ambient occlusion." >}}
## Results
The result is a field of grass that runs at 60-230 FPS on my test computer, depending on the density \(d\). Individual blades are different from each other due to the per-blade hash factor \(x_p\) but remain similar to nearby blades due to influence from the clumping factor \(x_c\) sampled from the cellular noise texture. The scrolling Perlin noise texture also does a pretty good job of emulating wind.

{{< figure src="/images/grass/result.png" alt="Final grass field rendered over rolling terrain in Godot" caption="Result at a density of 0.4. Uses terrain heightmap for demonstrative purposes." >}}

Here's a twenty-one second demo of an open field at a density of 0.4. For this scene, I used a terrain heightmap generated from simplex noise. The ground plane mesh uses an albedo based on the base and tip color, specified density \(d\), and distance from the camera.
{{< youtube MAErwFxp7_Y >}}
## Conclusion
I'm happy with how closely this captures the feel of Ghost of Tsushima's grass. There's still more I'd like to try, including the game's specular lighting and shadows, and its bezier curve approach to bending individual blades.

To use this in a game, I'd also need to add performance optimizations like view frustum culling and LOD switching.
## Source Code and References
[Source code for the project](https://github.com/rekomodo/6440_final).

1. [Procedural Grass in 'Ghost of Tsushima'](https://www.youtube.com/watch?v=Ibe1JBF5i5Y)
2. [Texture Generation using Random Noise](https://lodev.org/cgtutor/randomnoise.html)
3. [Similar implementation of this emulation](https://github.com/2Retr0/GodotGrass)
4. [How do Major Video Games Render Grass?](https://www.youtube.com/watch?v=bp7REZBV4P4)
5. [Modern Foliage Rendering](https://www.youtube.com/watch?v=jw00MbIJcrk)
## Acknowledgment
I'd like to thank the maintainers and contributors of the Godot game engine for providing an excellent platform on which to experiment with computer graphics.

I'd also like to thank the maintainers and contributors of the Blender 3D software for providing an excellent platform on which to create models and specify UV mappings.