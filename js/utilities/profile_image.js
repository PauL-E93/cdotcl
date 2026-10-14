function loadImageFromBlob(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Unable to read the selected profile picture.'));
        };
        image.src = objectUrl;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob);
                return;
            }

            reject(new Error('Unable to prepare the selected profile picture.'));
        }, type, quality);
    });
}

/**
 * Draw JPEG pixels using their EXIF orientation and export a metadata-independent
 * copy. This prevents phone photos from appearing sideways on hosts that do not
 * preserve or interpret EXIF orientation consistently.
 */
export async function normalizeProfileImage(file) {
    if (!(file instanceof File) || file.type !== 'image/jpeg') {
        return file;
    }

    let source;

    try {
        source = typeof createImageBitmap === 'function'
            ? await createImageBitmap(file, { imageOrientation: 'from-image' })
            : await loadImageFromBlob(file);

        const canvas = document.createElement('canvas');
        canvas.width = source.width || source.naturalWidth;
        canvas.height = source.height || source.naturalHeight;

        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');

        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);

        return new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: file.lastModified
        });
    } catch (error) {
        console.warn('Profile-picture orientation could not be normalized:', error);
        return file;
    } finally {
        if (source && typeof source.close === 'function') source.close();
    }
}
