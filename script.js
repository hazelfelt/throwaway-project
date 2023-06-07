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
    @group(0) @binding(0) var<uniform> resolution: vec2f;

    struct Vertex {
        @builtin(position) pos: vec4f,
        @location(0) color: vec4f,
    }

    struct Triangle {
        @location(1) color: vec4f,
        @location(2) scale: vec2f,
        @location(3) offset: vec2f,
    }

    @vertex fn main_vertex(
        @location(0) corner: vec2f,
        triangle: Triangle,
    ) -> Vertex {
        let pixel_pos = corner * triangle.scale + triangle.offset;
        let clip_pos = pixel_pos * 2.0 / resolution;
        return Vertex(vec4f(clip_pos, 0.0, 1.0), triangle.color);
    }

    @fragment fn main_fragment(
        @location(0) color: vec4f
    ) -> @location(0) vec4f {
        return vec4f(color.rgb * color.a, color.a); // premultiplied
    }
    `;

    const module = device.createShaderModule({
        label: "it's a shader!",
        code: wgsl,
    });



    // Pipeline.
    const pipeline = device.createRenderPipeline({
        label: "triangle pipeline",
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'main_vertex',
            buffers: [{
                // corner position buffer
                arrayStride: 4*2,
                stepMode: "vertex",
                attributes: [{
                    shaderLocation: 0,
                    format: "float32x2",
                    offset: 0,
                }]
            }, {
                // triangle buffer
                arrayStride: 4*8,
                stepMode: "instance",
                attributes: [{
                    // color
                    shaderLocation: 1,
                    format: "float32x4",
                    offset: 0,
                }, {
                    // scale
                    shaderLocation: 2,
                    format: "float32x2",
                    offset: 4*4,
                }, {
                    // offset
                    shaderLocation: 3,
                    format: "float32x2",
                    offset: 4*6,
                }]
            }]
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{
                format: canvasFormat,
                blend: {
                    color: {
                        operation: "add",
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                    },
                    alpha: {
                        operation: "add",
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                    }
                }
            }],
        },
    });



    // Triangle data.
    const triangles = [{
        color: [0.0, 1.0, 0.0, 0.9], // unassociated alpha
        scale: [300, 300],
        offset: [50, 50],
    }, {
        color: [1.0, 0.0, 0.0, 0.4], // unassociated alpha
        scale: [300, 300],
        offset: [-50, -50],
    }];


    // Buffers.
    // ...Canvas resolution uniform buffer.
    const resolutionBuffer = device.createBuffer({
        label: "resolution uniform",
        size: 4*2,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(
        resolutionBuffer, 0,
        new Float32Array([canvas.width, canvas.height])
    );

    // ...Corner position buffer.
    const positionBuffer = device.createBuffer({
        label: "position buffer",
        size: 4*2*3, // vec2f x 3
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const H = Math.sqrt(3)/2; // constant used for a "unit" isoceles triangle
    device.queue.writeBuffer(positionBuffer, 0, new Float32Array([
         0,    H/2,
         0.5, -H/2,
        -0.5, -H/2,
    ]));

    // ...Triangle buffer.
    const triangleBuffer = device.createBuffer({
        label: "triangle buffer",
        size: 4*8*triangles.length, // vec4f, 2f, 2f
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const triangleData = new Float32Array(8*triangles.length);
    for (let i = 0; i < triangles.length; ++i) {
        const triangle = triangles[i];
        triangleData.set(triangle.color,  i*8);
        triangleData.set(triangle.scale,  i*8 + 4);
        triangleData.set(triangle.offset, i*8 + 6);
    }
    device.queue.writeBuffer(triangleBuffer, 0, triangleData);



    // Bind group.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [{binding: 0, resource: {buffer: resolutionBuffer}}]
    });



    // Command encoder, render pass.
    const encoder = device.createCommandEncoder({ label: 'encoder' });
    const pass = encoder.beginRenderPass({
        label: 'render pass',
        colorAttachments: [
            { // We're rendering to the canvas's current texture.
                view: context.getCurrentTexture().createView(),
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, triangleBuffer);
    pass.draw(3, triangles.length);  // draw 3 vertices for each triangle
    pass.end();

    // We're done. Form a command buffer from `encoder`, and submit it.
    device.queue.submit([encoder.finish()]);
}

main().catch(err => console.error(err));