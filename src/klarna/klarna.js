import {
    getClientConfig,
    fetchPaymentMethods,
    fetchStoredPaymentMethods,
    makePayment,
    makeDetails,
    updateStateContainer,
    updatePaymentsLog,
    generateReference,
    generateReturnUrl,
    handleTestCardCopying
} from "../util.js";

// Enable test card copying
handleTestCardCopying();

// Function to get URL query parameters
const getQueryParam = (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

const showPaymentResult = (result, title = "Payment Result") => {
    const klarnaContainer = document.getElementById("klarna-container");
    if (!klarnaContainer) {
        console.error("Klarna container not found in the DOM.");
        return;
    }

    klarnaContainer.innerHTML = `
        <h2>${title}</h2>
        <p><strong>Status:</strong> ${result.resultCode || "Unknown"}</p>
    `;
};

const KLARNA_US_TEST_CASES = {
    approved: {
        email: "customer+us@klarna.com",
        phone: "+13106683312"
    },
    denied: {
        email: "customer+us+denied@klarna.com",
        phone: "+13106354386"
    },
    "new-user-signup": {
        email: "customer+us+new_user@klarna.com",
        phone: "+13105550134"
    },
    "id-scan": {
        email: "customer+us+denied+auth_id_scan@klarna.com",
        phone: "+13105550124"
    },
    "bank-authentication": {
        email: "customer+us+denied+auth_bank_login@klarna.com",
        phone: "+13105558963"
    },
    "email-verification": {
        email: "customer+us+denied+auth_otp_email@klarna.com",
        phone: "+13105558632"
    },
    "phone-verification": {
        email: "customer+us+denied+auth_otp_phone@klarna.com",
        phone: "+13105558633"
    },
    "card-security-code-verification": {
        email: "customer+us+denied+auth_cvv_entry@klarna.com",
        phone: "+13105558634"
    },
    "rejection-other": {
        email: "customer+us+reject_reason_other@klarna.com",
        phone: "+13105558637"
    },
    "rejection-identity": {
        email: "customer+us+reject_reason_could_not_establish_identity@klarna.com",
        phone: "+13105558636"
    },
    "rejection-credit-limit": {
        email: "customer+us+reject_reason_credit_limit_exceeded@klarna.com",
        phone: "+13105558638"
    },
    "rejection-previous-engagements": {
        email: "cust+reject_reason_customer_not_fulfilling_previous_engagements@klarna.com",
        phone: "+13105558639"
    },
    "rejection-external-hard": {
        email: "customer+us+reject_reason_external_hard_reject@klarna.com",
        phone: "+13105558640"
    },
    "rejection-high-risk": {
        email: "customer+us+reject_reason_high_risk@klarna.com",
        phone: "+13105558641"
    },
    "rejection-legal-restraints": {
        email: "customer+us+reject_reason_legal_restraints@klarna.com",
        phone: "+13105558642"
    },
    "rejection-technical-error": {
        email: "customer+us+reject_reason_technical_error@klarna.com",
        phone: "+13105558643"
    },
    "rejection-internal-block": {
        email: "customer+us+reject_reason_internal_block@klarna.com",
        phone: "+13105558644"
    },
    "rejection-low-credit-rating": {
        email: "customer+us+reject_reason_low_credit_rating@klarna.com",
        phone: "+13105558645"
    },
    "rejection-under-age": {
        email: "customer+us+reject_reason_under_age@klarna.com",
        phone: "+13105558646"
    },
    "rejection-denied": {
        email: "customer+us+reject_reason_denied@klarna.com",
        phone: "+13105558647"
    }
};

// Function to initialize the Klarna Component
document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM fully loaded and parsed.");

    const redirectResult = getQueryParam("redirectResult");
    if (redirectResult) {
        const inputContainer = document.querySelector(".input-container");
        const startPaymentButton = document.getElementById("start-payment");
        const stateContainer = document.getElementById("state-container");

        if (inputContainer) inputContainer.style.display = "none";
        if (startPaymentButton) startPaymentButton.style.display = "none";
        if (stateContainer) stateContainer.style.display = "none";

        const klarnaContainer = document.getElementById("klarna-container");
        if (!klarnaContainer) {
            console.error("Klarna container not found in the DOM.");
            return;
        }

        klarnaContainer.innerHTML = "<p>Processing your payment...</p>";

        try {
            const detailsResult = await makeDetails({ details: { redirectResult } });
            showPaymentResult(detailsResult);

            if (detailsResult.resultCode) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        } catch (error) {
            console.error("Error processing redirect result:", error);
        }

        return;
    }

    const referenceField = document.getElementById("reference");
    const returnUrlField = document.getElementById("returnUrl");

    if (referenceField && returnUrlField) {
        const reference = generateReference();
        referenceField.value = reference;
        returnUrlField.placeholder = generateReturnUrl(reference);
    }

    const testCaseSelect = document.getElementById("klarnaTestCase");
    testCaseSelect?.addEventListener("change", () => {
        const testCase = KLARNA_US_TEST_CASES[testCaseSelect.value];
        if (!testCase) return;

        document.getElementById("shopperEmail").value = testCase.email;
        document.getElementById("telephoneNumber").value = testCase.phone;
    });

    const startPaymentButton = document.getElementById("start-payment");
    if (!startPaymentButton) {
        console.error("Start payment button not found!");
        return;
    }

    startPaymentButton.addEventListener("click", async () => {
        console.log("Here we go! button clicked.");

        const klarnaOption = document.getElementById("klarnaOption")?.value ;
        const useRedirectFlow = document.getElementById("klarnaRedirect")?.checked;

        if (!klarnaOption) {
            alert("Please select a Klarna payment option.");
            return;
        }

        document.querySelector(".input-container").style.display = "none";
        startPaymentButton.style.display = "none";

        const countryCode = document.getElementById("countryCode")?.value || "GB";
        const telephoneNumber = document.getElementById("telephoneNumber")?.value ;//|| "+447755564318";
        const currency = document.getElementById("currency")?.value || "GBP";
        const value = parseInt(document.getElementById("amount")?.value || "20000", 10);
        const reference = document.getElementById("reference")?.value;
        const returnUrl = document.getElementById("returnUrl")?.value || generateReturnUrl(reference);
        const nativeThreeDS = document.getElementById("nativeThreeDS")?.checked ? "preferred" : undefined;
        const storePaymentMethod = document.getElementById("storePaymentMethod")?.checked ? true : false;
        const origin = window.location.origin;
        const shopperLocale = document.getElementById("shopperLocale")?.value || "en-GB";
        const shopperReference = document.getElementById("shopperReference")?.value || "guest";
        const shopperEmail = document.getElementById("shopperEmail")?.value || "customer@email.uk";

        //const shopperAddress = document.getElementById("shopperAddress")?.value || undefined;
        const shopperAddressValue = document.getElementById("shopperAddress")?.value;
        const shopperAddress = shopperAddressValue ? JSON.parse(shopperAddressValue) : undefined;

        const recurringProcessingModel = document.getElementById("recurringProcessingModel")?.value;
        const challengeWindowSize = document.getElementById("challengeWindowSize")?.value || "02";

        if (isNaN(value) || value < 0) {
            console.error("Invalid amount value. Please enter a valid number.");
            return;
        }

        const pmReqConfig = {
            countryCode,
            amount: { currency, value },
            allowedPaymentMethods: [ klarnaOption ],
            shopperEmail,
            shopperReference,
            shopperLocale
        };

        const storedPmConfig = {
            shopperReference
        };

        console.log("Payment request configuration:", pmReqConfig);

        try {
            const config = await getClientConfig();
            if (!config) throw new Error("Failed to load client config");

            const paymentMethodsResponse = await fetchPaymentMethods(pmReqConfig);
            if (!paymentMethodsResponse) throw new Error("Failed to load payment methods");

            // Check if klarnaOption exists in paymentMethods array
            const exists = paymentMethodsResponse.paymentMethods.some(
                pm => pm.type === klarnaOption
            );
            
            if (!exists) {
                alert("Selected Klarna option is not available.");
                //return;
            }

            renderStoredKlarnaMethods(shopperReference);
            //const storedPaymentMethodsResponse = await fetchStoredPaymentMethods(storedPmConfig);
            //console.log(storedPaymentMethodsResponse);

            if (!Array.isArray(paymentMethodsResponse.paymentMethods)) {
                console.error("Error: paymentMethodsResponse.paymentMethods is not an array", paymentMethodsResponse.paymentMethods);
            } else {
                console.log("paymentMethodsResponse.paymentMethods:", paymentMethodsResponse.paymentMethods);
            }
            
            const klarnaConfiguration = {
                type: klarnaOption,
                ...(useRedirectFlow ? {} : { useKlarnaWidget: true })
            };

            const configObj = {
                paymentMethodsResponse,
                clientKey: config.clientKey,
                locale: "en-US",
                environment: config.environment,
                countryCode,
                onChange: updateStateContainer,
                onSubmit: async (state, component, actions) => {
                    console.log('### klarna::onSubmit:: calling');
                    console.log('state.data:', state.data);

                    try {
                        document.getElementById("state-container").style.display = "none";

                        const paymentMethod = { ...state.data.paymentMethod };
                        if (useRedirectFlow && paymentMethod.subtype === "sdk") {
                            delete paymentMethod.subtype;
                        }

                        const paymentsReqData = {
                            ...state.data,
                            paymentMethod,
                            reference,
                            amount: { currency, value },
                            countryCode,
                            telephoneNumber,
                            shopperReference,
                            shopperLocale,
                            shopperEmail,
                            returnUrl,
                            origin,
                            channel: "Web",
                            storePaymentMethod : storePaymentMethod,
                            ...(recurringProcessingModel && { recurringProcessingModel }),
                            //billingAddress: shopperAddress,
                            //deliveryAddress: shopperAddress,
                            lineItems: [
                                {
                                  quantity: "1",
                                  amountExcludingTax: "20000",
                                  //taxPercentage: "2000",
                                  description: "Shoes",
                                  id: "Item #1",
                                  taxAmount: "4000",
                                  amountIncludingTax: "24000"
                                },
                                {
                                  quantity: "2",
                                  amountExcludingTax: "5000",
                                  //taxPercentage: "2000",
                                  description: "Socks",
                                  id: "Item #2",
                                  taxAmount: "1000",
                                  amountIncludingTax: "6000"
                                },
                                // The following line item specifies the discount
                                {
                                  quantity: "1",
                                  description: "Point redemption",
                                  id: "Point-Reddmption",
                                  amountIncludingTax: "-16000"
                                }
                              ]
                            //lineItems: [
                            //        {
                            //            quantity: "1",
                            //            description: "Shoes",
                            //            id: "Item #1"
                            //            //amountIncludingTax: "2000"
                            //        }
                            //    ]
                        };

                        updatePaymentsLog("Payment Request", paymentsReqData);
                        const result = await makePayment(paymentsReqData);
                        updatePaymentsLog("Payment Response", result );

                        if (!result.resultCode) {
                            console.error("Payment failed, missing resultCode.");
                            actions.reject();
                            return;
                        }

                        const {
                            resultCode,
                            action,
                            order,
                            donationToken
                        } = result;

                        actions.resolve({
                            resultCode,
                            action,
                            order,
                            donationToken,
                        });

                    } catch (error) {
                        console.error("Payment error:", error);
                        actions.reject();
                    }
                },
                onAdditionalDetails: async (state, component, actions) => {
                    console.log("### klarna::onAdditionalDetails:: calling");

                    try {
                        updatePaymentsLog("Details Request", state.data);
                        const result = await makeDetails(state.data);
                        updatePaymentsLog("Details Response", result);

                        if (!result.resultCode) {
                            console.error("Additional details processing failed: Missing resultCode.");
                            actions.reject();
                            return;
                        }

                        const { resultCode, action } = result;

                        console.log("Handling additional details:", { resultCode, action });
                        actions.resolve({ resultCode });
                        //actions.resolve({ resultCode, action });
                    } catch (error) {
                        console.error("Additional details processing error:", error);
                        actions.reject();
                    }
                },
                onPaymentCompleted: async (result, component) => {

                    console.log("### klarna::onPaymentCompleted:: calling");
                    console.log(result);

                    showPaymentResult(result);

                },
                onPaymentFailed: async (result, component) => {

                    console.log("### klarna::onPaymentFailed:: calling");
                    console.error(result);

                    showPaymentResult(result, "Payment Failed");

                }
            };

            const { AdyenCheckout, Klarna } = window.AdyenWeb;
            const checkout = await AdyenCheckout(configObj);
            const klarna = new Klarna(checkout,klarnaConfiguration).mount("#klarna-container");

        } catch (error) {
            console.error("Error during initialization:", error);
        }
    });
});

// Klarna options
const KLARNA_BRANDS = ["klarna", "klarna_paynow", "klarna_account"];

// Render stored Klarna options
export const renderStoredKlarnaMethods = async (shopperReference) => {
    try {
        const response = await fetchStoredPaymentMethods({ shopperReference });

        if (!response || !Array.isArray(response.storedPaymentMethods)) {
            console.log("No stored payment methods found for Klarna.");
            return;
        }

        const storedKlarna = response.storedPaymentMethods.filter(pm =>
            KLARNA_BRANDS.includes(pm.brand)
        );

        if (storedKlarna.length === 0) {
            console.log("No stored Klarna payment methods to display.");
            return;
        }

        const klarnaContainer = document.getElementById("klarna-container");
        if (!klarnaContainer) {
            console.error("#klarna-container not found in DOM.");
            return;
        }

        const existing = document.getElementById("stored-klarna-container");
        if (existing) existing.remove();

        const wrapper = document.createElement("div");
        wrapper.id = "stored-klarna-container";
        wrapper.className = "stored-klarna-wrapper";

        wrapper.innerHTML = `
            <h3 class="stored-klarna-title">Saved Klarna payments</h3>
            <div class="stored-klarna-list">
                ${storedKlarna.map(pm => `
                    <div class="stored-klarna-item" data-id="${pm.id}" data-brand="${pm.brand}">
                        <div class="stored-klarna-cell stored-klarna-brand">
                            ${pm.brand}
                        </div>
                        <div class="stored-klarna-cell stored-klarna-id">
                            ${pm.id}
                        </div>
                        <div class="stored-klarna-cell stored-klarna-action">
                            <button class="stored-klarna-button" data-id="${pm.id}" data-brand="${pm.brand}">
                                One Click to Pay!
                            </button>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;

        klarnaContainer.insertAdjacentElement("afterend", wrapper);

        wrapper.addEventListener("click", async (event) => {
            const button = event.target.closest(".stored-klarna-button");
            if (!button) return;
        
            const storedId = button.dataset.id;
            const brand = button.dataset.brand;
        
            console.log("Klarna One Click Pay clicked:", { storedId, brand });

            const countryCode = document.getElementById("countryCode")?.value || "GB";
            //const telephoneNumber = document.getElementById("telephoneNumber")?.value || "+447755564318";
            const currency = document.getElementById("currency")?.value || "GBP";
            const value = parseInt(document.getElementById("amount")?.value || "2000", 10);
            //const reference = document.getElementById("reference")?.value;
            //const returnUrl = document.getElementById("returnUrl")?.value || generateReturnUrl(reference);
            //const nativeThreeDS = document.getElementById("nativeThreeDS")?.checked ? "preferred" : undefined;
            //const storePaymentMethod = document.getElementById("storePaymentMethod")?.checked ? true : false;
            //const origin = window.location.origin;
            //const klarnaOption = document.getElementById("klarnaOption")?.value || "klarna_paynow";
            const shopperLocale = document.getElementById("shopperLocale")?.value || "en-GB";
            const shopperReference = document.getElementById("shopperReference")?.value || "guest";
            const shopperEmail = document.getElementById("shopperEmail")?.value || "customer@email.uk";
            const shopperAddress = document.getElementById("shopperAddress")?.value || undefined;
            const recurringProcessingModel = document.getElementById("recurringProcessingModel")?.value;
        
            const oneClickReq = {
                reference: "OneClick Klarna",
                amount: {
                    currency,
                    value
                },
                paymentMethod: {
                    type: brand,
                    storedPaymentMethodId: storedId
                },
                shopperReference,
                channel: "Web",
                shopperInteraction: "ContAuth",
                ...(recurringProcessingModel && { recurringProcessingModel }),
                shopperLocale,
                countryCode
            };
        
            console.log(oneClickReq);
        
            const result = await makePayment(oneClickReq);
            console.log(result);
        });

    } catch (error) {
        console.error("Error rendering stored Klarna payment methods:", error);
    }
};

