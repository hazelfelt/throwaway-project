@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var<uniform> atlas_size: vec2u;
@group(0) @binding(3) var<storage, read> chunk: array<array<u32, 64>>;

@fragment fn main(
    @builtin(position) pos: vec4f
) -> @location(0) vec4f {

    // The texture ID we will be sampling.
    let id = chunk[u32(pos.x)/8u][u32(pos.y)/8u];

    // The square on the atlas of which this texture is located.
    let atlas_pos = vec2u(
        id % atlas_size.x, 
        id / atlas_size.y
    );

    // UV coordinates on the atlas.
    let uv = (vec2f(atlas_pos) + fract(pos.xy/8.0)) / vec2f(atlas_size);
    return textureSample(atlas, atlas_sampler, uv);
}