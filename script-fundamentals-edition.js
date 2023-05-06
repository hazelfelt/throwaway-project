// this script (mostly) follows the tutorial from https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html !

async function main() {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');

    // Get a WebGPU context from the canvas and configure it.
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });

    const module = device.createShaderModule({
        label: 'red triangle shader',
        code: `
            @vertex fn vs(
                @builtin(vertex_index) vertexIndex : u32
            ) -> @builtin(position) vec4f {

                var pos = array<vec2f, 3>(
                    vec2f( 0.0,  0.5),  // top center
                    vec2f(-0.5, -0.5),  // bottom left
                    vec2f( 0.5, -0.5)   // bottom right
                );

                return vec4f(pos[vertexIndex], 0.0, 1.0);
            }

            @fragment fn fs() -> @location(0) vec4f {
                return vec4f(0.1, 0.75, 0.5, 1.0);
            }
        `,
    });

    const pipeline = device.createRenderPipeline({
        label: 'red triangle pipeline',
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


    function render() {

        // Command encoder.
        const encoder = device.createCommandEncoder({ label: 'encoder' });

        // Render pass.
        const pass = encoder.beginRenderPass({
            label: 'canvas render pass',
            colorAttachments: [
                {
                    // Get the current texture from the canvas context and
                    // set it as the texture to render to
                    view: context.getCurrentTexture().createView(),
                    clearValue: [0.3, 0.3, 0.3, 1],
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

    render();

    const observer = new ResizeObserver(entries => {
        const entry = entries[0];
        const canvas = entry.target;
        const width = entry.contentBoxSize[0].inlineSize;
        const height = entry.contentBoxSize[0].blockSize;
        canvas.width = Math.min(width, device.limits.maxTextureDimension2D);
        canvas.height = Math.min(height, device.limits.maxTextureDimension2D);
        render();
    });

    observer.observe(canvas);
}

main().catch(err => {
    console.error(err);
});