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
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(12) color: vec4f,
};

@vertex fn vs(
    @builtin(vertex_index) index : u32
) -> VertexOut {

    var position = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    var color = array<vec4f, 3>(
        vec4f(1.0, 0.0, 0.0, 1.0), // red
        vec4f(0.0, 1.0, 0.0, 1.0), // green
        vec4f(0.0, 0.0, 1.0, 1.0), // blue
    );

    var out: VertexOut;
    out.position = vec4f(position[index], 0.0, 1.0);
    out.color = color[index];

    return out;
}

@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
    let grid_coords = vec2u(input.position.xy) / 32u;
    let square_type = (grid_coords.x + grid_coords.y) % 2u == 0u;
    return input.color * select(3.0, 2.0, square_type);
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
pass.draw(3);  // call our vertex shader 3 times
pass.end();

// We're done -- submit a command buffer formed from the `encoder`.
device.queue.submit([encoder.finish()]);

}

main().catch(err => {
    console.error(err);
});