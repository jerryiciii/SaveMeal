import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { MediaStorage } from '../media/media-storage';
import { SupabaseMediaStorage } from '../media/supabase-media-storage';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Global()
@Module({
  controllers: [ImagesController],
  providers: [
    ImagesService,
    {
      provide: MediaStorage,
      inject: [AppConfig],
      useFactory: (config: AppConfig): MediaStorage => {
        if (config.mediaStorage === 'supabase') {
          return new SupabaseMediaStorage({
            supabaseUrl: config.supabaseStorage.url!,
            serviceRoleKey: config.supabaseStorage.serviceRoleKey!,
            bucket: config.supabaseStorage.bucket,
          }) as unknown as MediaStorage;
        }
        return new MediaStorage(config);
      },
    },
  ],
  exports: [ImagesService, MediaStorage],
})
export class ImagesModule {}
