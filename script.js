(async () => {

if (!navigator.gpu) throw new Error("Doesn't look like WebGPU is available!");

// Adapter, device, and canvas context.
let adapter = await navigator.gpu.requestAdapter();
let device = await adapter.requestDevice();

let canvas = document.querySelector('canvas');
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

let context = canvas.getContext('webgpu');

context.configure({
    device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
});

// Buffers.
// (i dont get how this code works, especially the `writeArray` bit.)
let createBuffer = (arr, usage) => {
    let buffer = device.createBuffer({
        size: (arr.byteLength + 3) & ~3, // align to 4 bytes
        usage,
        mappedAtCreation: true
    });

    const writeArray = arr instanceof Uint16Array
            ? new Uint16Array(buffer.getMappedRange())
            : new Float32Array(buffer.getMappedRange());

    writeArray.set(arr);
    buffer.unmap();
    return buffer;
};

let positionBuffer = createBuffer(new Float32Array([
    1.0, -1.0, 0.0,
    -1.0, -1.0, 0.0,
    0.0, 1.0, 0.0
]), GPUBufferUsage.VERTEX);

let colorBuffer = createBuffer(new Float32Array([
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0
]), GPUBufferUsage.VERTEX);

let indexBuffer = createBuffer(new Uint16Array([
    0, 1, 2
]), GPUBufferUsage.INDEX);

// Shader.
let shaderModule = device.createShaderModule({ code: `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) color: vec3f,
};

@vertex
fn vert_main(@location(0) position: vec3f,
             @location(1) color: vec3f) -> VertexOut {
    var out: VertexOut;
    out.position = vec4f(position, 1.0);
    out.color = color;
    return out;
}

@fragment
fn frag_main(@location(0) color: vec3f) -> @location(0) vec4f {
    return vec4f(color, 1.0);
}` });

// Pipeline.
let pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [] }),

    vertex: {
        module: shaderModule,
        entryPoint: 'vert_main',
        buffers: [

            { // Position buffer.
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3'
                }],
                arrayStride: 4 * 3, // sizeof(float) * 3
                stepMode: 'vertex'
            },

            { // Color buffer.
                attributes: [{
                    shaderLocation: 1,
                    offset: 0,
                    format: 'float32x3'
                }],
                arrayStride: 4 * 3, // sizeof(float) * 3
                stepMode: 'vertex'
            }
        ]
    },

    fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{ // color state
            format: 'bgra8unorm',
            writeMask: GPUColorWrite.ALL
        }]
    },

    primitive: {
        frontFace: 'cw',
        cullMode: 'none',
        topology: 'triangle-list'
    },
});

// Render.
let render = () => {

    // Command encoder.
    let commandEncoder = device.createCommandEncoder();

    // Render pass.
    let passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        }]
    });

    passEncoder.setPipeline(pipeline);
    passEncoder.setViewport(
        0, 0,
        canvas.width, canvas.height,
        0, 1
    );
    passEncoder.setScissorRect(
        0, 0,
        canvas.width, canvas.height
    );
    passEncoder.setVertexBuffer(0, positionBuffer);
    passEncoder.setVertexBuffer(1, colorBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint16');
    passEncoder.drawIndexed(3, 1);
    passEncoder.end();

    // We're done -- submit a command buffer formed from the `commandEncoder`.
    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(render); // refresh canvas
}

render();

})().catch(err => {
    console.error(err)
});