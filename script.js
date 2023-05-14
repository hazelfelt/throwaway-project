// this script (mostly) follows the tutorial from https://webgpufundamentals.org

async function main() {



// Adapter, device.
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('need a browser that supports WebGPU');



// Canvas and WebGPU context.
const canvas = document.querySelector('canvas');
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

const context = canvas.getContext('webgpu');
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
    device,
    format: canvasFormat,
});



// Shader.
// (TODO: understand WGSL better)
const wgsl = `
struct Triangle {
    color: vec4f,
    scale: vec2f,
    offset: vec2f,
};

struct VSOut {
    @location(0) color: vec4f,
    @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(1) var<uniform> color_offset: vec4f;

@vertex fn vs(
    @builtin(vertex_index) index: u32,
    @builtin(instance_index) instance_index: u32
) -> VSOut {

    var position = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    let triangle = triangles[instance_index];
    var out: VSOut;
    out.color = triangle.color;
    out.position = vec4f(position[index] * triangle.scale + triangle.offset, 0.0, 1.0);
    return out;
}

@fragment fn fs(input: VSOut) -> @location(0) vec4f {
    return input.color + color_offset;
}`;

const module = device.createShaderModule({
    label: "it's a shader!",
    code: wgsl,
});



// Pipeline.
const pipeline = device.createRenderPipeline({
    label: "it's a pipeline!",
    layout: 'auto',
    vertex: {
        module,
        entryPoint: 'vs',
    },
    fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: canvasFormat }],
    },
});



// "Static" shader-wide uniform buffer.
// ...It's just a "color offset" vec4f -- see the shader code for reference.
const uniformStaticBufferSize = 4*4; // vec4f = 4 bytes * 4 floats = 16 bytes
const uniformStaticBuffer = device.createBuffer({
    size: uniformStaticBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const uniformStaticValues = new Float32Array([-0.5, -0.5, -0.5, 0.0]);
device.queue.writeBuffer(uniformStaticBuffer, 0, uniformStaticValues);



// Triangles!
const triangles = [];
const triangleCount = 10;
for (let i = 0; i < 10; ++i) {
    triangles.push({
        color:  [ 0.1 + i*0.1,  0.3 + i*0.1, 0.7 + i*0.1, 1.0 ],
        scale:  [ 1.0 - i*0.09, 1.0 - i*0.09                  ],
        offset: [ 0.0 + i*0.1,  0.0 + i*0.1                   ],
    });
}



// Triangle storage buffer.
// (this really needs to be refactored! somehow)
const triangleFloats = 4+2+2;
const triangleBuffer = device.createBuffer({
    size: 4 * triangleFloats * triangleCount, // (4+2+2) * 4 bytes per triangle
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const triangleData = new Float32Array((4+2+2) * triangleCount);
for (let i = 0; i < triangleCount; ++i) {
    triangleData.set(triangles[i].color,   0 + i*triangleFloats)
    triangleData.set(triangles[i].scale,   4 + i*triangleFloats)
    triangleData.set(triangles[i].offset,  6 + i*triangleFloats)
}

device.queue.writeBuffer(triangleBuffer, 0, triangleData);

const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: triangleBuffer } },
        { binding: 1, resource: { buffer: uniformStaticBuffer } },
    ]
});



// Command encoder, render pass.
const encoder = device.createCommandEncoder({ label: 'encoder' });
const pass = encoder.beginRenderPass({
    label: 'render pass',
    colorAttachments: [
        {
            // We're rendering to the canvas's current texture.
            view: context.getCurrentTexture().createView(),
            clearValue: [1.0, 1.0, 1.0, 1.0],
            loadOp: 'clear',
            storeOp: 'store',
        },
    ],
});

pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.draw(3, triangleCount);  // call vertex shader 3 times
pass.end();



// We're done. Form a command buffer from `encoder`, and submit it.
device.queue.submit([encoder.finish()]);



}

main().catch(err => {
    console.error(err);
});