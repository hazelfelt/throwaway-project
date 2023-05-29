@vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
    return vec4f(pos, 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> resolution: vec2f;
@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var line_frame: texture_2d<f32>;
@group(0) @binding(3) var prev_frame: texture_2d<f32>;

@fragment fn main_fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = pos.xy / resolution;

    let line_fragment = textureSample(line_frame, frame_sampler, uv);
    let trail_fragment = textureSample(prev_frame, frame_sampler, uv) - vec4(0.02, 0.04, 0.01, 0.05);
    return select(trail_fragment, line_fragment, line_fragment.a > 0.01);
}