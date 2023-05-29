@vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
    return vec4f(pos, 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> resolution: vec2f;
@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var frame: texture_2d<f32>;

@fragment fn main_fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = pos.xy / resolution;
    let fragment = textureSample(frame, frame_sampler, uv);
    return select(vec4f(0.0, 0.0, 0.0, 1.0), fragment, fragment.a > 0.01);
}