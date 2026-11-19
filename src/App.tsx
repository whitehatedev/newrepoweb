/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect } from 'react';
import { PlatformProvider, usePlatform } from './context/PlatformContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { FaqPage, PolicyPage } from './pages/AboutAndLegalPages';
import {
  ServicesOverviewPage,
  CustomEngineeringServicePage,
  PcbServicePage,
  DroneRepairServicePage,
} from './pages/ServicesPages';
import { Printing3DPage } from './pages/Printing3DPage';
import { ShopListingPage, ProductDetailPage, CartPage, CheckoutPage } from './pages/ShopPages';
import { ProjectsShowcasePage, ProjectDetailPage, ProjectEnquiryPage } from './pages/ProjectsAndEnquiryPages';
import { B2BPortalPage } from './pages/B2BPage';
import { BlogsListPage, BlogDetailPage, ContactPage, TrackOrderPage } from './pages/BlogsAndContactPages';
import { CustomerDashboardPage } from './pages/CustomerDashboardPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { KrashivantriPage } from './pages/KrashivantriPage';
import { KrashivantriProductPage, KrashivantriComparePage } from './pages/KrashivantriProductPage';
import { FarmerPortalPage, PilotPortalPage } from './pages/KrashivantriPortalsPage';
import { CustomCmsPage } from './pages/CustomCmsPage';
import { WebsiteEditorPage } from './pages/WebsiteEditorPage';
import { AuthCallbackPage, LoginPage, RegisterPage } from './pages/AuthPages';
import { NagpurPage, MaharashtraPage } from './pages/LocalSeoPages';

const RedirectHome: React.FC = () => {
  const { navigate } = usePlatform();
  useEffect(() => {
    navigate('/');
  }, [navigate]);
  return null;
};

const AppRouter: React.FC = () => {
  const { path, navigate } = usePlatform();
  const normalized = path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;

  const renderRoute = () => {
    if (normalized === '/') return <HomePage />;
    if (normalized === '/about' || normalized.startsWith('/about/')) return <RedirectHome />;
    if (normalized === '/services') return <ServicesOverviewPage />;
    if (
      normalized === '/services/custom-engineering' ||
      normalized === '/services/custom-engineering-projects'
    ) {
      return <CustomEngineeringServicePage />;
    }
    if (normalized === '/services/pcb-design') return <PcbServicePage />;
    if (normalized === '/services/3d-printing') return <Printing3DPage />;
    if (normalized === '/services/drone-repair') return <DroneRepairServicePage />;

    if (normalized === '/projects') return <ProjectsShowcasePage />;
    if (normalized.startsWith('/projects/')) {
      const slug = decodeURIComponent(normalized.replace('/projects/', ''));
      return <ProjectDetailPage slug={slug} />;
    }
    if (normalized === '/register-project' || normalized === '/project-enquiry') {
      return <ProjectEnquiryPage />;
    }

    if (normalized === '/krashivantri') return <KrashivantriPage />;
    if (
      normalized === '/krashivantri-x' ||
      normalized === '/product/krashivantri-x' ||
      normalized === '/products/krashivantri-x'
    ) {
      return <KrashivantriProductPage slug="krashivantri-x" />;
    }
    if (
      normalized === '/krashivantri-x-pro' ||
      normalized === '/product/krashivantri-x-pro' ||
      normalized === '/products/krashivantri-x-pro'
    ) {
      return <KrashivantriProductPage slug="krashivantri-x-pro" />;
    }
    if (normalized === '/krashivantri/compare') return <KrashivantriComparePage />;
    if (normalized === '/krashivantri/enquiry') return <KrashivantriPage initialScrollToEnquiry />;
    if (normalized === '/krashivantri/farmer-portal') return <FarmerPortalPage />;
    if (normalized === '/krashivantri/pilot-portal') return <PilotPortalPage />;

    if (normalized === '/login') return <LoginPage />;
    if (normalized === '/register') return <RegisterPage />;
    if (normalized === '/auth/callback') return <AuthCallbackPage />;

    if (normalized === '/shop' || normalized === '/store') return <ShopListingPage />;
    if (normalized.startsWith('/shop/category/')) {
      const slug = decodeURIComponent(normalized.replace('/shop/category/', ''));
      return <ShopListingPage categorySlug={slug} />;
    }
    if (normalized.startsWith('/store/category/')) {
      const slug = decodeURIComponent(normalized.replace('/store/category/', ''));
      return <ShopListingPage categorySlug={slug} />;
    }
    if (normalized.startsWith('/product/')) {
      const slug = decodeURIComponent(normalized.replace('/product/', ''));
      return <ProductDetailPage slug={slug} />;
    }
    if (normalized.startsWith('/products/')) {
      const slug = decodeURIComponent(normalized.replace('/products/', ''));
      return <ProductDetailPage slug={slug} />;
    }
    if (normalized.startsWith('/p/')) {
      const slug = decodeURIComponent(normalized.replace('/p/', ''));
      return <CustomCmsPage slug={slug} />;
    }
    if (normalized === '/store/3d-printed-products') return <ShopListingPage scope="3d_printed" />;
    if (normalized === '/store/offers' || normalized === '/sale') return <ShopListingPage saleOnly />;

    if (normalized === '/b2b') return <B2BPortalPage />;
    if (normalized === '/blogs') return <BlogsListPage />;
    if (normalized.startsWith('/blogs/')) {
      const slug = decodeURIComponent(normalized.replace('/blogs/', ''));
      return <BlogDetailPage slug={slug} />;
    }

    if (normalized === '/nagpur') return <NagpurPage />;
    if (normalized === '/maharashtra') return <MaharashtraPage />;
    if (normalized === '/contact') return <ContactPage />;
    if (normalized === '/faq') return <FaqPage />;
    if (normalized === '/shipping-policy') {
      return <PolicyPage type="shipping" title="Shipping Policy" />;
    }
    if (normalized === '/return-refund-policy') {
      return <PolicyPage type="returnRefund" title="Return & Refund Policy" />;
    }
    if (normalized === '/privacy-policy') {
      return <PolicyPage type="privacy" title="Privacy Policy" />;
    }
    if (normalized === '/terms-and-conditions') {
      return <PolicyPage type="terms" title="Terms & Conditions" />;
    }

    if (normalized === '/my-account') return <CustomerDashboardPage />;
    if (normalized === '/my-account/orders') return <CustomerDashboardPage initialTab="orders" />;
    if (normalized === '/my-account/track-orders') return <CustomerDashboardPage initialTab="tracking" />;
    if (normalized === '/my-account/invoices') return <CustomerDashboardPage initialTab="invoices" />;
    if (normalized === '/my-account/addresses') return <CustomerDashboardPage initialTab="addresses" />;
    if (normalized === '/my-account/enquiries') return <CustomerDashboardPage initialTab="enquiries" />;
    if (normalized === '/my-account/reviews') return <CustomerDashboardPage initialTab="reviews" />;
    if (normalized === '/my-account/wishlist') return <CustomerDashboardPage initialTab="wishlist" />;
    if (normalized === '/my-account/profile') return <CustomerDashboardPage initialTab="profile" />;
    if (normalized === '/my-account/project-enquiries') {
      return <CustomerDashboardPage initialTab="projects" />;
    }
    if (normalized === '/cart') return <CartPage />;
    if (normalized === '/checkout') return <CheckoutPage />;
    if (normalized === '/track-order') return <TrackOrderPage />;
    if (normalized === '/admin/login') return <AdminLoginPage />;
    if (normalized === '/admin' || normalized === '/admin/dashboard') return <AdminDashboardPage />;
    if (normalized === '/admin/website-editor') return <WebsiteEditorPage />;
    if (normalized === '/admin/project-enquiries' || normalized === '/admin/projects') {
      return <AdminDashboardPage initialTab="projects" />;
    }
    if (normalized === '/admin/project-settings' || normalized === '/admin/settings/project-payments') {
      return <AdminDashboardPage initialTab="project_payment_settings" />;
    }
    if (normalized === '/admin/project-finance') {
      return <AdminDashboardPage initialTab="project_finance" />;
    }
    if (normalized === '/admin/settings/payments') {
      return <AdminDashboardPage initialTab="payment_settings" />;
    }
    if (normalized === '/admin/farmers') {
      return <AdminDashboardPage initialTab="krash_farmers" />;
    }
    if (normalized === '/admin/drone-pilots') {
      return <AdminDashboardPage initialTab="krash_pilots" />;
    }
    if (normalized === '/admin/live-tracking') {
      return <AdminDashboardPage initialTab="krash_live_tracking" />;
    }
    if (normalized === '/admin/orders/live') {
      return <AdminDashboardPage initialTab="krash_orders_live" />;
    }
    if (normalized === '/admin/farmer-payments') {
      return <AdminDashboardPage initialTab="krash_farmer_payments" />;
    }
    if (normalized === '/admin/pilot-payouts') {
      return <AdminDashboardPage initialTab="krash_pilot_payouts" />;
    }
    if (normalized === '/admin/penalties') {
      return <AdminDashboardPage initialTab="krash_penalties" />;
    }
    if (normalized === '/admin/finance') {
      return <AdminDashboardPage initialTab="krash_finance" />;
    }

    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-5">
        <div className="font-mono text-xs font-semibold text-[#64B5F6]">404 — Route Not Found</div>
        <h1 className="font-display text-3xl font-bold text-[#123B5D]">
          Page Not Available
        </h1>
        <p className="text-sm text-[#263746]">
          The requested path <span className="font-mono font-semibold text-[#123B5D]">{normalized}</span> does not match an active page on NexusTekFusion.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2.5 rounded-lg bg-[#64B5F6] hover:bg-[#42A5F5] text-white text-sm font-semibold transition-colors"
          >
            Back to Home
          </button>
          <button
            onClick={() => navigate('/store')}
            className="px-5 py-2.5 rounded-lg border border-[#90CAF9] bg-white text-[#123B5D] text-sm font-semibold hover:bg-[#F0F8FF] hover:border-[#42A5F5] transition-colors"
          >
            Browse Store
          </button>
        </div>
      </div>
    );
  };

  return <Layout>{renderRoute()}</Layout>;
};

export default function App() {
  return (
    <PlatformProvider>
      <AppRouter />
    </PlatformProvider>
  );
}
