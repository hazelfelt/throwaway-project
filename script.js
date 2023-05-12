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
const wgsl = `
struct UniformStruct {
    color: vec4f,
    scale: vec2f,
    offset: vec2f,
};

@group(0) @binding(0) var<uniform> uniform_struct: UniformStruct;
@group(0) @binding(1) var<uniform> uniform_color_offset: vec4f;

@vertex fn vs(
    @builtin(vertex_index) index : u32
) -> @builtin(position) vec4f {

    var position = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    return vec4f(position[index] * uniform_struct.scale + uniform_struct.offset, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) input: vec4f) -> @location(0) vec4f {
    return uniform_struct.color + uniform_color_offset;
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
// (We don't make a bind group here for... reasons! Reasons mostly pertaining to the strange architecture of this script.)
const uniformStaticBufferSize = 4*4; // vec4f = 4 bytes * 4 floats = 16 bytes
const uniformStaticBuffer = device.createBuffer({
    size: uniformStaticBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const uniformStaticValues = new Float32Array([-0.5, -0.5, -0.5, 0.0]);
device.queue.writeBuffer(uniformStaticBuffer, 0, uniformStaticValues);



// "Dynamic" triangle-specifc uniform buffers, and their bind groups.
const objectCount = 10;

const uniformBuffers = [];
const bindGroups = [];

for (let i = 0; i < objectCount; ++i) {

    const uniformBufferSize = 4*4 + 2*4 + 2*4;

    // The triangle-specific uniform buffer.
    const buffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    uniformBuffers.push(buffer);

    // The triangle-specific uniform buffer data.
    const values = new Float32Array(uniformBufferSize / 4);
    values.set([ 0.1+i*0.1  ,  0.30+i*0.1 , 0.7+i*0.1, 1 ], 0); // color
    values.set([ 2.0-i*0.2  ,  2.00-i*0.2                ], 4); // scale
    values.set([-0.5+i*0.08 , -0.25                      ], 6); // offset
    device.queue.writeBuffer(buffer, 0, values);

    // The triangle-specific bind group.
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: buffer }},
            { binding: 1, resource: { buffer: uniformStaticBuffer }},
            // ^^^ wow! we're reusing the same static buffer across every triangle. pretty cool
        ],
    });
    bindGroups.push(bindGroup);

}



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
for (let i = 0; i < objectCount; ++i) {
    pass.setBindGroup(0, bindGroups[i]);
    pass.draw(3);  // call vertex shader 3 times
}
pass.end();



// We're done. Form a command buffer from `encoder`, and submit it.
device.queue.submit([encoder.finish()]);



}

main().catch(err => {
    console.error(err);
});