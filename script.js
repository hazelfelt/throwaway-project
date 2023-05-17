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
    struct Triangle {
        color: array<vec3f, 3>,
        scale: vec2f,
        offset: vec2f,
    };

    struct Vertex {
        @location(0) color: vec3f,
        @builtin(position) position: vec4f,
    }

    @group(0) @binding(0) var<uniform> initial: Triangle;
    @group(0) @binding(1) var<uniform> delta: Triangle;

    const corner = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    @vertex fn main_vertex(
        @builtin(vertex_index) v: u32,
        @builtin(instance_index) i: u32,
    ) -> Vertex {

        let color = initial.color[v] + f32(i)*delta.color[v];
        let position = vec4f(
            corner[v]
            * (initial.scale  + f32(i)*delta.scale)
            + (initial.offset + f32(i)*delta.offset),
            0.0, 1.0
        );

        return Vertex(color, position);
    }

    @fragment fn main_fragment(
        @location(0) color: vec3f,
    ) -> @location(0) vec4f {
        return vec4f(color, 1.0);
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
            entryPoint: 'main_vertex',
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // Triangle data.
    const triangleCount = 10;

    const initialTriangle = {
        color: [
            [ -0.3,  0.3,  0.3 ],
            [ -0.3,  0.6,  0.3 ],
            [ -0.3, -0.1,  0.3 ],
        ],
        scale: [1.0, 1.0],
        offset: [-0.3, -0.3],
    };

    const deltaTriangle = {
        color: [
            [ 0.1, 0.1, 0.1 ],
            [ 0.1, 0.1, 0.1 ],
            [ 0.1, 0.1, 0.1 ],
        ],
        scale: [-0.09, -0.09],
        offset: [0.1, 0.1],
    };



    // Given triangle data, this helper function writes to a GPU buffer and returns it.
    function triangleBuffer(triangle) {
        const buffer = device.createBuffer({
            size: 4 * 16, // 16 floats per triangle (includes padding).
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const array = new Float32Array(16);
        array.set(triangle.color[0], 0);
        array.set(triangle.color[1], 4);
        array.set(triangle.color[2], 8);
        array.set(triangle.scale,   12);
        array.set(triangle.offset,  14);
        device.queue.writeBuffer(buffer, 0, array);

        return buffer;
    }

    const initialBuffer = triangleBuffer(initialTriangle);
    const deltaBuffer = triangleBuffer(deltaTriangle);

    // Bind group for the initial + delta triangle uniform buffers.
    const bindGroup = device.createBindGroup({
        label: "triangle bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: initialBuffer } },
            { binding: 1, resource: { buffer: deltaBuffer   } },
        ]
    })


    // Render.
    function render() {

        // Command encoder, render pass.
        const encoder = device.createCommandEncoder({ label: 'encoder' });
        const pass = encoder.beginRenderPass({
            label: 'render pass',
            colorAttachments: [
                { // We're rendering to the canvas's current texture.
                    view: context.getCurrentTexture().createView(),
                    clearValue: [1.0, 1.0, 1.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3, triangleCount);  // draw 3 vertices, with `triangleCount` different instances
        pass.end();

        // We're done. Form a command buffer from `encoder`, and submit it.
        device.queue.submit([encoder.finish()]);

    }
    render();



    // Whenever the canvas is clicked.
    document.querySelector("canvas").onmousedown = function () {
        console.log("this should do something...");
        render();
    }
}

main().catch(err => {
    console.error(err);
});