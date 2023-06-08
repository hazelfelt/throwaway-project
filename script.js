async function main() {

    // Adapter, device.
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');



    // Canvas and WebGPU context.
    const canvas = document.querySelector('canvas');
    const zoom = 4;
    canvas.width  = canvas.clientWidth / zoom;
    canvas.height = canvas.clientHeight / zoom;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // Chunk rendering shader.
    const wgsl = `
    @vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
        return vec4f(pos, 0.0, 1.0);
    }

    @group(0) @binding(0) var atlas: texture_2d<f32>;
    @group(0) @binding(1) var atlas_sampler: sampler;
    @group(0) @binding(2) var<uniform> atlas_size: vec2u;
    @group(0) @binding(3) var<storage, read> chunk: array<array<u32, 16>, 16>;

    @fragment fn main_fragment(
        @builtin(position) pos: vec4f
    ) -> @location(0) vec4f {

        // The texture ID we will be sampling.
        let id = chunk[u32(pos.y)/8u][u32(pos.x)/8u];

        // The square on the atlas of which this texture is located.
        let atlas_pos = vec2u(
            id % atlas_size.x,
            id / atlas_size.x
        );

        // UV coordinates on the atlas.
        let uv = (vec2f(atlas_pos) + fract(pos.xy/8.0)) / vec2f(atlas_size);

        // Sampler.
        return textureSample(atlas, atlas_sampler, uv);
    }`;

    const module = device.createShaderModule({
        label: "chunk shader",
        code: wgsl,
    });



    // Pipeline.
    const pipeline = device.createRenderPipeline({
        label: "chunk rendering pipeline",
        layout: 'auto',
        primitive: {
            topology: "triangle-strip"
        },
        vertex: {
            module,
            entryPoint: 'main_vertex',
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x2'
                }]
            }],
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // Vertex buffer.
    const vertexBuffer = device.createBuffer({
        label: "vertex buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        vertexBuffer, 0,
        new Float32Array([
            -1,  1,
            -1, -1,
             1,  1,
             1, -1,
        ])
    );



    // Atlas .png file and sampler.
    const atlasElement = document.querySelector("img");
    const source = await createImageBitmap(atlasElement, { colorSpaceConversion: "none" });
    const texture = device.createTexture({
        label: "atlas texture",
        format: 'rgba8unorm',
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture },
        { width: source.width, height: source.height },
    );

    const sampler = device.createSampler({
        magFilter: 'nearest',
    });



    // Atlas size buffer.
    const atlasSizeBuffer = device.createBuffer({
        label: "atlas size uniform",
        size: 2*4, // one vec2u
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(
        atlasSizeBuffer,
        0,
        new Uint32Array([4, 1])
    );

    // Chunk buffer.
    const chunkBuffer = device.createBuffer({
        label: "chunk storage buffer",
        size: 16*16*4, // 16x16 grid of u32s
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const chunkArray = new Uint32Array(16*16);
    for (let y = 0; y < 16; ++y) {
        for (let x = 0; x < 16; ++x) {
            chunkArray.set([(y+x/2)%4], y*16 + x);
        }
    }

    device.queue.writeBuffer(chunkBuffer, 0, chunkArray);



    // Bind group.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: texture.createView()},
            {binding: 1, resource: sampler},
            {binding: 2, resource: {buffer: atlasSizeBuffer}},
            {binding: 3, resource: {buffer: chunkBuffer}},
        ]
    })



    // Command encoder, render pass.
    const encoder = device.createCommandEncoder({ label: 'encoder' });
    const pass = encoder.beginRenderPass({
        label: 'render pass',
        colorAttachments: [
            { // We're rendering to the canvas's current texture.
                view: context.getCurrentTexture().createView(),
                clearValue: [0.02, 0.05, 0.1, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();

    // We're done. Form a command buffer from `encoder`, and submit it.
    device.queue.submit([encoder.finish()]);
}



// Prevent Edge's context menu.
window.onmouseup = event => event.preventDefault();

main().catch(err => console.error(err));