import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import { extractIndexFromFilename, logInfo, logError, logDebug } from './utils.js';

// S3 클라이언트 초기화
const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey
  }
});

// 이미지 목록 캐시
let imageListCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 1000 * 60 * 60; // 1시간

/**
 * S3 버킷의 이미지 목록 조회 및 정렬
 * @param {boolean} forceRefresh - 캐시 무시하고 강제로 새로고침
 * @returns {Promise<Array>} 정렬된 이미지 목록
 */
export async function listImages(forceRefresh = false) {
  try {
    // 캐시 확인
    if (!forceRefresh && imageListCache && cacheTimestamp) {
      const cacheAge = Date.now() - cacheTimestamp;
      if (cacheAge < CACHE_TTL) {
        logDebug('이미지 목록 캐시 사용');
        return imageListCache;
      }
    }
    
    logInfo('S3에서 이미지 목록 조회 중...');
    
    const command = new ListObjectsV2Command({
      Bucket: config.aws.s3BucketName,
      Prefix: '' // 버킷 전체 조회
    });
    
    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      logInfo('S3 버킷에 이미지가 없습니다.');
      return [];
    }
    
    // 이미지 파일만 필터링 (jpg, jpeg, png)
    const images = response.Contents
      .filter(obj => {
        const key = obj.Key.toLowerCase();
        return key.endsWith('.jpg') || key.endsWith('.jpeg') || key.endsWith('.png');
      })
      .map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        index: extractIndexFromFilename(obj.Key)
      }))
      .filter(img => img.index > 0) // 인덱스가 있는 파일만
      .sort((a, b) => a.index - b.index); // 인덱스 순으로 정렬
    
    // 캐시 저장
    imageListCache = images;
    cacheTimestamp = Date.now();
    
    logInfo(`총 ${images.length}개의 이미지를 찾았습니다.`);
    logDebug('이미지 목록', images.map(img => `${img.index}: ${img.key}`));
    
    return images;
  } catch (error) {
    logError('S3 이미지 목록 조회 실패', error);
    throw error;
  }
}

/**
 * 전체 이미지 개수 조회
 * @returns {Promise<number>} 이미지 개수
 */
export async function getTotalImageCount() {
  try {
    const images = await listImages();
    return images.length;
  } catch (error) {
    logError('이미지 개수 조회 실패', error);
    return 0;
  }
}

/**
 * 특정 인덱스의 이미지 조회
 * @param {number} index - 이미지 인덱스
 * @returns {Promise<Object|null>} 이미지 정보
 */
export async function getImageByIndex(index) {
  try {
    const images = await listImages();
    const image = images.find(img => img.index === index);
    
    if (!image) {
      logInfo(`인덱스 ${index}에 해당하는 이미지가 없습니다.`);
      return null;
    }
    
    return image;
  } catch (error) {
    logError(`인덱스 ${index} 이미지 조회 실패`, error);
    return null;
  }
}

/**
 * 다음 인덱스의 이미지 조회
 * @param {number} currentIndex - 현재 인덱스
 * @returns {Promise<Object|null>} 다음 이미지 정보
 */
export async function getNextImage(currentIndex) {
  try {
    const nextIndex = currentIndex + 1;
    return await getImageByIndex(nextIndex);
  } catch (error) {
    logError('다음 이미지 조회 실패', error);
    return null;
  }
}

/**
 * S3에서 이미지 다운로드 (Buffer로 반환)
 * @param {string} key - S3 객체 키
 * @returns {Promise<Buffer>} 이미지 버퍼
 */
export async function downloadImage(key) {
  try {
    logInfo(`이미지 다운로드 중: ${key}`);
    
    const command = new GetObjectCommand({
      Bucket: config.aws.s3BucketName,
      Key: key
    });
    
    const response = await s3Client.send(command);
    
    // Stream을 Buffer로 변환
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    logInfo(`이미지 다운로드 완료: ${key} (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    logError(`이미지 다운로드 실패: ${key}`, error);
    throw error;
  }
}

/**
 * 특정 인덱스의 이미지 다운로드
 * @param {number} index - 이미지 인덱스
 * @returns {Promise<Object|null>} { buffer, key, index } 형식의 객체
 */
export async function downloadImageByIndex(index) {
  try {
    const image = await getImageByIndex(index);
    
    if (!image) {
      logInfo(`인덱스 ${index}에 해당하는 이미지가 없습니다.`);
      return null;
    }
    
    const buffer = await downloadImage(image.key);
    
    return {
      buffer,
      key: image.key,
      index: image.index
    };
  } catch (error) {
    logError(`인덱스 ${index} 이미지 다운로드 실패`, error);
    return null;
  }
}

/**
 * 이미지 목록 캐시 초기화
 */
export function clearImageCache() {
  imageListCache = null;
  cacheTimestamp = null;
  logInfo('이미지 목록 캐시 초기화');
}

/**
 * 이미지 존재 여부 확인
 * @param {number} index - 이미지 인덱스
 * @returns {Promise<boolean>} 존재 여부
 */
export async function imageExists(index) {
  try {
    const image = await getImageByIndex(index);
    return image !== null;
  } catch (error) {
    return false;
  }
}

/**
 * 인덱스 범위 검증
 * @param {number} index - 확인할 인덱스
 * @returns {Promise<Object>} { valid, min, max, total } 형식의 객체
 */
export async function validateIndex(index) {
  try {
    const images = await listImages();
    
    if (images.length === 0) {
      return {
        valid: false,
        min: 0,
        max: 0,
        total: 0,
        message: 'S3 버킷에 이미지가 없습니다.'
      };
    }
    
    const minIndex = images[0].index;
    const maxIndex = images[images.length - 1].index;
    const valid = index >= minIndex && index <= maxIndex;
    
    return {
      valid,
      min: minIndex,
      max: maxIndex,
      total: images.length,
      message: valid ? 'OK' : `인덱스는 ${minIndex}에서 ${maxIndex} 사이여야 합니다.`
    };
  } catch (error) {
    logError('인덱스 검증 실패', error);
    return {
      valid: false,
      min: 0,
      max: 0,
      total: 0,
      message: '인덱스 검증 중 오류 발생'
    };
  }
}

/**
 * S3 연결 테스트
 * @returns {Promise<boolean>} 연결 성공 여부
 */
export async function testS3Connection() {
  try {
    logInfo('S3 연결 테스트 중...');
    
    const command = new ListObjectsV2Command({
      Bucket: config.aws.s3BucketName,
      MaxKeys: 1
    });
    
    await s3Client.send(command);
    logInfo('S3 연결 성공');
    return true;
  } catch (error) {
    logError('S3 연결 실패', error);
    return false;
  }
}

export default {
  listImages,
  getTotalImageCount,
  getImageByIndex,
  getNextImage,
  downloadImage,
  downloadImageByIndex,
  clearImageCache,
  imageExists,
  validateIndex,
  testS3Connection
};
