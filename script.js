async function init() {

    // Canvas, entry.
    let canvas = document.querySelector('canvas');
    let entry = navigator.gpu;
    if (!entry) console.error("Doesn't look like WebGPU is available!");

    // Adapter, device, queue.
    let adapter = await entry.requestAdapter();
    let device = await adapter.requestDevice();
    let queue = device.queue;

    // Canvas context.
    let context = canvas.getContext('webgpu');

    context.configure({
        device: device,
        alphaMode: "opaque",
        format: 'bgra8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    let depthTexture = device.createTexture({
        size: [canvas.width, canvas.height, 1],
        dimension: '2d',
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    let depthTextureView = depthTexture.createView();

    // Buffers.
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

    // Shaders.
    const vertWgsl = `
    struct VSOut {
        @builtin(position) Position: vec4<f32>,
        @location(0) color: vec3<f32>,
    };

    @vertex
    fn main(@location(0) inPos: vec3<f32>,
            @location(1) inColor: vec3<f32>) -> VSOut {
        var vsOut: VSOut;
        vsOut.Position = vec4<f32>(inPos, 1.0);
        vsOut.color = inColor;
        return vsOut;
    }`;

    const fragWgsl = `
    @fragment
    fn main(@location(0) inColor: vec3<f32>) -> @location(0) vec4<f32> {
        return vec4<f32>(inColor, 1.0);
    }
    `;

    let vertModule = device.createShaderModule({ code: vertWgsl });
    let fragModule = device.createShaderModule({ code: fragWgsl });

    // Color/blend state.
    const colorState = {
        format: 'bgra8unorm',
        writeMask: GPUColorWrite.ALL
    };

    let pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),

        vertex: {
            module: vertModule,
            entryPoint: 'main',
            buffers: [

                { // Position buffer.
                    attributes: [{
                        shaderLocation: 0, // [[attribute(0)]]
                        offset: 0,
                        format: 'float32x3'
                    }],
                    arrayStride: 4 * 3, // sizeof(float) * 3
                    stepMode: 'vertex'
                },

                { // Color buffer.
                    attributes: [{
                        shaderLocation: 1, // [[attribute(1)]]
                        offset: 0,
                        format: 'float32x3'
                    }],
                    arrayStride: 4 * 3, // sizeof(float) * 3
                    stepMode: 'vertex'
                }
            ]
        },

        fragment: {
            module: fragModule,
            entryPoint: 'main',
            targets: [colorState]
        },

        primitive: {
            frontFace: 'cw',
            cullMode: 'none',
            topology: 'triangle-list'
        },

        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        }
    });

    // Render
    let render = () => {

        // Write and submit commands to queue.
        let commandEncoder = device.createCommandEncoder();

        // Encode drawing commands.
        let passEncoder = commandEncoder.beginRenderPass({

            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }],

            depthStencilAttachment: {
                view: depthTextureView,
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                stencilClearValue: 0,
                stencilLoadOp: 'clear',
                stencilStoreOp: 'store',
            }
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

        queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(render); // refresh canvas
    }

    render();
}

init();