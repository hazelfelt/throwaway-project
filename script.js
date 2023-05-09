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
    return uniform_struct.color;
}`;

const module = device.createShaderModule({
    label: 'grid triangle shader',
    code: wgsl,
});

// Pipeline.
const pipeline = device.createRenderPipeline({
    label: 'grid triangle pipeline',
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

// Uniform buffer.
const uniformBufferSize = 4*4 + 2*4 + 2*4;
const uniformBuffer = device.createBuffer({
    size: 4*4 + 2*4 + 2*4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const uniformValues = new Float32Array(uniformBufferSize / 4);
uniformValues.set([0, 1, 0, 1], 0); // color
uniformValues.set([2.0, 2.0], 4) // scale
uniformValues.set([-0.5, -0.25], 6); // offset
device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

// Bind group.
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformBuffer }},
    ],
});

// Command encoder and render pass.
const encoder = device.createCommandEncoder({ label: 'encoder' });
const pass = encoder.beginRenderPass({
    label: 'render pass',
    colorAttachments: [
        {
            // Get the current texture from the canvas context and
            // set it as the texture to render to
            view: context.getCurrentTexture().createView(),
            clearValue: [1.0, 1.0, 1.0, 1.0],
            loadOp: 'clear',
            storeOp: 'store',
        },
    ],
});

pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.draw(3);  // call our vertex shader 3 times
pass.end();

// We're done -- submit a command buffer formed from the `encoder`.
device.queue.submit([encoder.finish()]);

}

main().catch(err => {
    console.error(err);
});