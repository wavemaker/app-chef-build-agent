const AWS = require('aws-sdk');
const async = require('async');
const fs = require('fs');
const logger = require('@wavemaker/wm-cordova-cli/src/logger');

const errorOnNull = (obj, k) => {
    const v = obj[k];
    if (v) {
        return v;
    }
    throw new Error('No value found for : ' + k);
};

const uploadToS3 = (filePath, iConfig) => {
    const s3Client = new AWS.S3({
        accessKeyId: errorOnNull(iConfig, 'accessKeyId'),
        secretAccessKey: errorOnNull(iConfig, 'secretAccessKey'),
        region: errorOnNull(iConfig, 'region')
    }),
    bucketName = errorOnNull(iConfig, 'bucketName'),
    key = errorOnNull(iConfig, 'key');
    //return uploadMultipart(s3Client, errorOnNull(iConfig, 'bucketName'), errorOnNull(iConfig, 'key'), filePath)
    return uploadDirectly(s3Client, bucketName, key, filePath)
        .then(() => {
            return s3Client.getSignedUrl('getObject', {
                Bucket: bucketName,
                Key: key
            }).split('?')[0];
        });
};

const uploadDirectly = async (s3Client, bucketName, key, filePath) => {
    return new Promise((resolve, reject) => {
        s3Client.upload({
            Bucket: bucketName,
            Key: key,
            Body: fs.createReadStream(filePath)
        }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

const uploadMultipart = async (s3Client, bucketName, fileName, fromAbsoluteFilePath) => {
    return new Promise((resolve, reject) => {
        s3Client.createMultipartUpload({
            Bucket: bucketName,
            Key: fileName
        }, (mpErr, multipart) => {
            if (!mpErr) {
                //console.log("multipart created", multipart.UploadId);
                fs.readFile(fromAbsoluteFilePath, (err, fileData) => {

                    var partSize = 1024 * 1024 * 5;
                    var parts = Math.ceil(fileData.length / partSize);

                    async.timesSeries(parts, (partNum, next) => {

                        var rangeStart = partNum * partSize;
                        var end = Math.min(rangeStart + partSize, fileData.length);

                        console.log("uploading ", fileName, " % ", (partNum / parts).toFixed(2));

                        partNum++;
                        async.retry((retryCb) => {
                            s3Client.uploadPart({
                                Body: fileData.slice(rangeStart, end),
                                Bucket: bucketName,
                                Key: fileName,
                                PartNumber: partNum,
                                UploadId: multipart.UploadId
                            }, (err, mData) => {
                                retryCb(err, mData);
                            });
                        }, (err, data) => {
                            //console.log(data);
                            next(err, {
                                ETag: data.ETag,
                                PartNumber: partNum
                            });
                        });

                    }, (err, dataPacks) => {
                        s3Client.completeMultipartUpload({
                            Bucket: bucketName,
                            Key: fileName,
                            MultipartUpload: {
                                Parts: dataPacks
                            },
                            UploadId: multipart.UploadId
                        }, resolve);
                    });
                });
            } else {
                reject(mpErr);
            }
        });
    });
}


module.exports = {
    uploadToS3: async (filePath, iConfig) => {
        const retryAttempts = iConfig.retryAttempts || 1;
        let i = 1;
        const tryUpload = async () => {
            logger.info(`Trying(${i}) to upload the artifact to s3`);
            return uploadToS3(filePath, iConfig).catch(() => {
                if (i++ < retryAttempts) {
                    return tryUpload();
                };
            });
        };
        await tryUpload();
    }
};