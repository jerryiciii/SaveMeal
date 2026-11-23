import { Global, Module } from '@nestjs/common';
import { MediaStorage } from '../media/media-storage';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Global()
@Module({
  controllers: [ImagesController],
  providers: [ImagesService, MediaStorage],
  exports: [ImagesService, MediaStorage],
})
export class ImagesModule {}
