# Credits

## The look

The colours, the glowing lines and the film grain were inspired by **Filip Zrnzevic's pen**
<https://codepen.io/filipz/pen/dPygJGM> - an audio visualizer, not a gauge. Its colour presets
(Cool, Neon, Warm, Cyberpunk, Monochrome) became the five engines' palettes, its three
sound-reactive lines became the engine lines behind the gauges, and its type choice is used
here too.

**No code was copied from it.** Public pens are MIT licensed by CodePen ("Public pens are
automatically MIT licensed", <https://blog.codepen.io/documentation/licensing/>, checked
2026-10-20), but the pen's shader is marked as based on Shadertoy shader
<https://www.shadertoy.com/view/MtVBzG>, and Shadertoy shaders that state no licence of their
own fall under Creative Commons Attribution-NonCommercial-ShareAlike 3.0. (Shadertoy's terms
page refuses automated reads; that default is as stated by several sites that republish its
shaders.) To stay clear of both, every line here was written fresh and only the look was taken.

## Fonts

Served from [fonts/](fonts/), so the page fetches nothing at runtime. Both are under the SIL
Open Font License 1.1; each licence is beside its font.

- **Boldonse** - Copyright 2024 The Boldonse Project Authors
  (<https://github.com/googlefonts/boldonse>). [Licence](fonts/Boldonse-OFL.txt)
- **Bodoni Moda** - Copyright 2020 The Bodoni Moda Project Authors
  (<https://github.com/indestructible-type/Bodoni>). [Licence](fonts/BodoniModa-OFL.txt)

## Engine figures

Each engine copies the bore and stroke of a real naturally aspirated engine - the V4 a
2-litre four's, there being no modern car V4 of that size - and is tested against that
engine's published torque, power and redline. The references are
named in [engines/params.js](engines/params.js). The page itself names no maker: the engines
are types - V4, V6, V8, V10, V12 - not brands.
