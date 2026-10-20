// Frontend of instagram-video: the pack of each track and the « À publier » list.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { PackPage } from './PackPage';
import { ToPublishPage } from './ToPublishPage';
import './instagram.css';

export default defineFrontendModule({
  pages: [
    { path: '', component: PackPage },
    { path: 'a-publier', component: ToPublishPage },
  ],
});
