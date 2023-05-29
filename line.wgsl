@group(0) @binding(0) var<uniform> resolution: vec2f;

@vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
    return vec4f(pos*2.0/resolution, 0.0, 1.0);
}

@fragment fn main_fragment() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}