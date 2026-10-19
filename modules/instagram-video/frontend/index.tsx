// Frontend of instagram-video: track picker, excerpt waveform, preview, render, caption.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { InstagramPage } from './InstagramPage';
import './instagram.css';

export default defineFrontendModule({
  pages: [{ path: '', component: InstagramPage }],
});
