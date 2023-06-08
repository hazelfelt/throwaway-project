@group(0) @binding(0) var<uniform> resolution: vec2f;

struct Vertex {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
}

@vertex fn main_vertex(@location(0) pos: vec2f) -> Vertex {
    let clip_pos = vec4f(pos, 0.0, 1.0);
    let uv = pos * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
    return Vertex(clip_pos, vec2f(uv.x, uv.y));
}

@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var line_frame: texture_2d<f32>;
@group(0) @binding(3) var prev_frame: texture_2d<f32>;

struct Fragment {
    @location(0) canvas: vec4f,
    @location(1) trail: vec4f,
}

@fragment fn main_fragment(@location(0) uv: vec2f) -> Fragment {
    let hm = resolution;
    let line_sample = textureSample(line_frame, frame_sampler, uv);
    let trail_sample = textureSample(prev_frame, frame_sampler, uv);

    let trail = select(trail_sample, line_sample, line_sample.a > 0.01) - vec4f(0.01, 0.03, 0.015, 0.01);

    let canvas = select(line_sample, trail, trail.a > 0.25);
    let canvas_premultiplied = vec4f(canvas.rgb * canvas.a, canvas.a);

    return Fragment(canvas_premultiplied, trail);
}